import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { waitForConvexHealthy } from './convex-health.js';
import { localConvexCloudUrl } from './convex-local-config.js';
import { waitForConvexDevReadyFromLogs } from './convex-readiness.js';
import { waitForDaemonReadyFromLogs } from './daemon-readiness.js';
import { LogBufferStore } from './log-buffer.js';
import { buildProcessDefinitions } from './process-definitions.js';
import type { ProcessDefinition } from './process-definitions.js';
import { saveSavedRuntimeConfig } from './saved-runtime-config.js';
import { waitForWebappHttpReady, waitForWebappReadyFromLogs } from './webapp-readiness.js';
import type {
  HealthStatus,
  LogLine,
  ManagedProcessId,
  ProcessInfo,
  RuntimeConfig,
  SessionPhase,
} from '../shared/protocol.js';

type ManagerEvents = {
  process: [ProcessInfo];
  log: [LogLine];
  phase: [SessionPhase];
  'logs-clear': [ManagedProcessId];
};

export class ProcessManager extends EventEmitter<ManagerEvents> {
  private readonly repoRoot: string;
  private readonly managerPort: number;
  private readonly logs = new LogBufferStore();
  private readonly children = new Map<ManagedProcessId, ChildProcess>();
  private readonly state = new Map<ManagedProcessId, ProcessInfo>();
  private readonly lineBuffers = new Map<ManagedProcessId, string>();
  private _phase: SessionPhase = 'idle';
  private _runtimeConfig: RuntimeConfig | null = null;
  private startGeneration = 0;

  constructor(repoRoot: string, managerPort: number) {
    super();
    this.repoRoot = repoRoot;
    this.managerPort = managerPort;
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.state.set(id, {
        id,
        name:
          id === 'convex'
            ? 'Convex (local)'
            : id === 'webapp'
              ? 'Webapp (production build)'
              : 'Chatroom Daemon',
        status: 'stopped',
        pid: null,
        startedAt: null,
        exitedAt: null,
        exitCode: null,
        health: 'unknown',
        healthDetail: null,
      });
    }
  }

  get phase(): SessionPhase {
    return this._phase;
  }

  get runtimeConfig(): RuntimeConfig | null {
    return this._runtimeConfig;
  }

  getProcesses(): ProcessInfo[] {
    return [...this.state.values()];
  }

  getLogSnapshot() {
    return this.logs.snapshot();
  }

  private subscribeToLogs(handler: (line: LogLine) => void): () => void {
    const onLog = (line: LogLine) => handler(line);
    this.on('log', onLog);
    return () => this.off('log', onLog);
  }

  async startStack(config: RuntimeConfig): Promise<void> {
    if (this._phase === 'starting' || this._phase === 'running') return;

    const generation = ++this.startGeneration;
    const isStale = () => generation !== this.startGeneration;

    this._runtimeConfig = config;
    saveSavedRuntimeConfig(this.repoRoot, config);
    this._phase = 'starting';
    this.emit('phase', this._phase);

    await this.stopAll();
    this.clearAllProcessLogs();

    this.updateState('convex', {
      name: config.convexBackendMode === 'hosted' ? 'Convex (hosted)' : 'Convex (local)',
    });

    const definitions = buildProcessDefinitions(this.repoRoot, config, this.managerPort);

    for (const def of definitions) {
      this.updateState(def.id, {
        status: 'pending',
        health: 'unknown',
        healthDetail: def.id === 'convex' ? null : 'Waiting for Convex',
      });
    }

    if (config.convexBackendMode === 'local') {
      const convexDef = definitions.find((d) => d.id === 'convex');
      if (convexDef) {
        this.start(convexDef);
        this.updateState('convex', {
          health: 'checking',
          healthDetail: 'Waiting for functions ready',
        });

        const result = await waitForConvexDevReadyFromLogs(
          (handler) => this.subscribeToLogs(handler),
          {
            onWaiting: () =>
              this.updateState('convex', {
                health: 'checking',
                healthDetail: 'Waiting for functions ready',
              }),
          }
        );

        if (isStale()) return;

        if (!result.ok) {
          this.updateState('convex', { health: 'unhealthy', healthDetail: result.reason });
          await this.stopAll();
          this._phase = 'failed';
          this.emit('phase', this._phase);
          return;
        }

        const convexUrl = localConvexCloudUrl(this.repoRoot, config.convexPort);
        this.updateState('convex', {
          health: 'checking',
          healthDetail: 'Waiting for Convex HTTP',
        });

        const httpHealth = await waitForConvexHealthy(convexUrl, {
          onCheck: () =>
            this.updateState('convex', {
              health: 'checking',
              healthDetail: 'Waiting for Convex HTTP',
            }),
        });

        if (isStale()) return;

        if (!httpHealth.ok) {
          this.updateState('convex', { health: 'unhealthy', healthDetail: httpHealth.reason });
          await this.stopAll();
          this._phase = 'failed';
          this.emit('phase', this._phase);
          return;
        }

        this.updateState('convex', { health: 'healthy', healthDetail: null });
      }
    } else {
      this.clearProcessLogs('convex');
      const convexState = this.state.get('convex');
      if (convexState) {
        convexState.status = 'skipped';
        convexState.health = 'healthy';
        convexState.healthDetail = 'Hosted \u2014 external';
        this.emit('process', convexState);
      }

      this.updateState('convex', { health: 'checking', healthDetail: 'Checking hosted Convex' });
      const result = await waitForConvexHealthy(config.convexUrl, {
        onCheck: () =>
          this.updateState('convex', {
            health: 'checking',
            healthDetail: 'Checking hosted Convex',
          }),
      });

      if (isStale()) return;

      if (!result.ok) {
        this.updateState('convex', { health: 'unhealthy', healthDetail: result.reason });
        this._phase = 'failed';
        this.emit('phase', this._phase);
        return;
      }

      this.updateState('convex', { health: 'healthy', healthDetail: 'Hosted \u2014 external' });
    }

    if (isStale()) return;

    for (const def of definitions) {
      if (def.id !== 'convex') {
        if (def.id === 'webapp') {
          this.updateState('webapp', {
            health: 'checking',
            healthDetail: 'Building production bundle',
          });
        }
        if (def.id === 'daemon') {
          this.updateState('daemon', {
            health: 'checking',
            healthDetail: 'Building CLI and starting daemon',
          });
        }
        this.start(def);
      }
    }

    this.monitorWebappReadiness(config);
    this.monitorDaemonReadiness();

    if (isStale()) return;
    this._phase = 'running';
    this.emit('phase', this._phase);
  }

  private monitorWebappReadiness(config: RuntimeConfig): void {
    const webappUrl = `http://localhost:${config.webappPort}`;

    void waitForWebappReadyFromLogs((handler) => this.subscribeToLogs(handler), {
      onWaiting: () =>
        this.updateState('webapp', {
          health: 'checking',
          healthDetail: 'Building and starting server',
        }),
    }).then(async (result) => {
      if (!result.ok) {
        this.updateState('webapp', { health: 'unhealthy', healthDetail: result.reason });
        return;
      }

      this.updateState('webapp', {
        health: 'checking',
        healthDetail: 'Waiting for HTTP response',
      });

      const health = await waitForWebappHttpReady(webappUrl, {
        onCheck: () =>
          this.updateState('webapp', {
            health: 'checking',
            healthDetail: 'Waiting for HTTP response',
          }),
      });
      if (!health.ok) {
        this.updateState('webapp', { health: 'unhealthy', healthDetail: health.reason });
        return;
      }

      this.updateState('webapp', {
        health: 'healthy',
        healthDetail: webappUrl,
      });
    });
  }

  private monitorDaemonReadiness(): void {
    void waitForDaemonReadyFromLogs((handler) => this.subscribeToLogs(handler), {
      onWaiting: () =>
        this.updateState('daemon', {
          health: 'checking',
          healthDetail: 'Building CLI and starting daemon',
        }),
    }).then((result) => {
      if (!result.ok) {
        this.updateState('daemon', { health: 'unhealthy', healthDetail: result.reason });
        return;
      }

      this.updateState('daemon', {
        health: 'healthy',
        healthDetail: 'Listening for commands',
      });
    });
  }

  async stopStack(): Promise<void> {
    this.startGeneration++;
    this._phase = 'stopping';
    this.emit('phase', this._phase);
    await this.stopAll();
    this._phase = 'idle';
    this._runtimeConfig = null;
    this.emit('phase', this._phase);

    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.updateState(id, {
        status: 'stopped',
        health: 'unknown',
        healthDetail: null,
      });
    }
  }

  async restart(id: ManagedProcessId): Promise<void> {
    this.clearAllProcessLogs();
    if (id === 'convex') {
      await this.stopAll();
      if (this._runtimeConfig) {
        await this.startStack(this._runtimeConfig);
      }
      return;
    }
    this.stop(id);
    if (id === 'webapp') {
      this.updateState('webapp', { health: 'checking', healthDetail: 'Restarting...' });
    }
    if (id === 'daemon') {
      this.updateState('daemon', { health: 'checking', healthDetail: 'Restarting...' });
    }
    const def = this._runtimeConfig
      ? buildProcessDefinitions(this.repoRoot, this._runtimeConfig).find((d) => d.id === id)
      : undefined;
    if (def) {
      this.start(def);
      if (id === 'webapp' && this._runtimeConfig) {
        this.monitorWebappReadiness(this._runtimeConfig);
      }
      if (id === 'daemon') {
        this.monitorDaemonReadiness();
      }
    }
  }

  stop(id: ManagedProcessId): void {
    const child = this.children.get(id);
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    this.children.delete(id);
    this.updateState(id, { status: 'stopped', pid: null });
  }

  async stopAll(): Promise<void> {
    for (const id of this.children.keys()) {
      this.stop(id);
    }
  }

  private start(def: ProcessDefinition): void {
    this.clearProcessLogs(def.id);
    this.updateState(def.id, {
      status: 'starting',
      startedAt: Date.now(),
      exitedAt: null,
      exitCode: null,
      pid: null,
    });

    const child = spawn(def.command, def.args, {
      cwd: def.cwd,
      env: { ...process.env, ...def.env },
      shell: def.shell,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.children.set(def.id, child);
    this.updateState(def.id, { status: 'running', pid: child.pid ?? null });

    const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const pending = (this.lineBuffers.get(def.id) ?? '') + chunk.toString('utf8');
      const parts = pending.split(/\r?\n/);
      this.lineBuffers.set(def.id, parts.pop() ?? '');
      for (const line of parts) {
        if (!line) continue;
        const logLine = this.logs.append({
          processId: def.id,
          stream,
          text: line,
          timestamp: Date.now(),
        });
        this.emit('log', logLine);
      }
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    child.on('exit', (code) => {
      this.lineBuffers.delete(def.id);
      this.children.delete(def.id);
      const crashed = code !== 0;
      this.updateState(def.id, {
        status: crashed ? 'crashed' : 'stopped',
        pid: null,
        exitedAt: Date.now(),
        exitCode: code,
      });
    });
  }

  private clearAllProcessLogs(): void {
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.lineBuffers.delete(id);
    }
    this.logs.clearAll();
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.emit('logs-clear', id);
    }
  }

  private clearAllProcessLogs(): void {
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.lineBuffers.delete(id);
    }
    this.logs.clearAll();
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.emit('logs-clear', id);
    }
  }

  private clearProcessLogs(id: ManagedProcessId): void {
    this.lineBuffers.delete(id);
    this.logs.clear(id);
    this.emit('logs-clear', id);
  }

  private updateState(id: ManagedProcessId, patch: Partial<ProcessInfo>): void {
    const current = this.state.get(id);
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      health: patch.health ?? current.health ?? ('unknown' as HealthStatus),
      healthDetail: patch.healthDetail !== undefined ? patch.healthDetail : current.healthDetail,
    };
    this.state.set(id, next);
    this.emit('process', next);
  }
}
