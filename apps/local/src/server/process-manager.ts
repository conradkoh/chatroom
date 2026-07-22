import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { waitForConvexHealthy } from './convex-health.js';
import { waitForConvexDevReadyFromLogs } from './convex-readiness.js';
import { LogBufferStore } from './log-buffer.js';
import { buildProcessDefinitions } from './process-definitions.js';
import type { ProcessDefinition } from './process-definitions.js';
import { waitForWebappReadyFromLogs } from './webapp-readiness.js';
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
  private _phase: SessionPhase = 'idle';
  private _runtimeConfig: RuntimeConfig | null = null;

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
    this._runtimeConfig = config;
    this._phase = 'starting';
    this.emit('phase', this._phase);

    const definitions = buildProcessDefinitions(this.repoRoot, config);

    // Initialize processes and broadcast so the dashboard shows startup progress immediately.
    for (const def of definitions) {
      this.updateState(def.id, {
        status: 'pending',
        health: 'unknown',
        healthDetail: def.id === 'convex' ? null : 'Waiting for Convex',
      });
    }

    // Handle convex (local only)
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

        if (!result.ok) {
          this.updateState('convex', { health: 'unhealthy', healthDetail: result.reason });
          this._phase = 'idle';
          this._runtimeConfig = null;
          this.emit('phase', this._phase);
          return;
        }

        this.updateState('convex', { health: 'healthy', healthDetail: null });
      }
    } else {
      // Hosted mode: convex is skipped
      const convexState = this.state.get('convex');
      if (convexState) {
        convexState.status = 'skipped';
        convexState.health = 'healthy';
        convexState.healthDetail = 'Hosted — external';
        this.emit('process', convexState);
      }

      // Health check hosted URL
      this.updateState('webapp', { health: 'checking', healthDetail: 'Checking hosted Convex' });
      const result = await waitForConvexHealthy(config.convexUrl, {
        onCheck: () => this.updateState('webapp', { health: 'checking' }),
      });

      if (!result.ok) {
        this.updateState('webapp', { health: 'unhealthy', healthDetail: result.reason });
        this._phase = 'idle';
        this._runtimeConfig = null;
        this.emit('phase', this._phase);
        return;
      }
    }

    // Start webapp and daemon
    for (const def of definitions) {
      if (def.id !== 'convex') {
        if (def.id === 'webapp') {
          this.updateState('webapp', {
            health: 'checking',
            healthDetail: 'Building production bundle',
          });
        }
        this.start(def);
      }
    }

    this.monitorWebappReadiness(config);

    this._phase = 'running';
    this.emit('phase', this._phase);
  }

  private async checkWebappServing(
    webappUrl: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const res = await fetch(`${webappUrl.replace(/\/$/, '')}/`);
      if (res.ok) return { ok: true };
      return { ok: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' };
    }
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

      const health = await this.checkWebappServing(webappUrl);
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

  async stopStack(): Promise<void> {
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

  restart(id: ManagedProcessId): void {
    if (id === 'convex') {
      this.stopAll();
      if (this._runtimeConfig) {
        void this.startStack(this._runtimeConfig);
      }
    } else {
      this.stop(id);
      const def = this._runtimeConfig
        ? buildProcessDefinitions(this.repoRoot, this._runtimeConfig).find((d) => d.id === id)
        : undefined;
      if (def) this.start(def);
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
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
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

  private clearProcessLogs(id: ManagedProcessId): void {
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
