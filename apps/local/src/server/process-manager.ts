import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { waitForConvexHealthy } from './convex-health.js';
import { LogBufferStore } from './log-buffer.js';
import type { LocalConfig } from './parse-config.js';
import type { ProcessDefinition } from './process-definitions.js';
import type { HealthStatus, LogLine, ManagedProcessId, ProcessInfo } from '../shared/protocol.js';

type ManagerEvents = {
  process: [ProcessInfo];
  log: [LogLine];
};

export class ProcessManager extends EventEmitter<ManagerEvents> {
  private readonly definitions: ProcessDefinition[];
  private readonly config: LocalConfig;
  private readonly logs = new LogBufferStore();
  private readonly children = new Map<ManagedProcessId, ChildProcess>();
  private readonly state = new Map<ManagedProcessId, ProcessInfo>();

  constructor(definitions: ProcessDefinition[], config: LocalConfig) {
    super();
    this.definitions = definitions;
    this.config = config;
    for (const def of definitions) {
      const isDependent = def.id === 'webapp' || def.id === 'daemon';
      this.state.set(def.id, {
        id: def.id,
        name: def.name,
        status: isDependent ? 'pending' : 'stopped',
        pid: null,
        startedAt: null,
        exitedAt: null,
        exitCode: null,
        health: 'unknown',
        healthDetail: isDependent ? 'Waiting for Convex' : null,
      });
    }
  }

  getProcesses(): ProcessInfo[] {
    return [...this.state.values()];
  }

  getLogSnapshot() {
    return this.logs.snapshot();
  }

  async startAll(): Promise<void> {
    this.updateState('webapp', {
      status: 'pending',
      health: 'unknown',
      healthDetail: 'Waiting for Convex',
    });
    this.updateState('daemon', {
      status: 'pending',
      health: 'unknown',
      healthDetail: 'Waiting for Convex',
    });

    await this.runStartupSequence();
  }

  restart(id: ManagedProcessId): void {
    if (id === 'convex') {
      this.stopAll();
      void this.startAll();
    } else {
      this.stop(id);
      this.start(id);
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

  private async runStartupSequence(): Promise<void> {
    this.start('convex');
    this.updateState('convex', { health: 'checking', healthDetail: 'Waiting for /version' });

    const result = await waitForConvexHealthy(this.config.convexUrl, {
      onCheck: () => this.updateState('convex', { health: 'checking' }),
    });

    if (!result.ok) {
      this.updateState('convex', {
        health: 'unhealthy',
        healthDetail: result.reason,
      });
      return;
    }

    this.updateState('convex', { health: 'healthy', healthDetail: null });
    this.start('webapp');
    this.start('daemon');
  }

  private start(id: ManagedProcessId): void {
    const def = this.definitions.find((d) => d.id === id);
    if (!def) return;

    this.updateState(id, {
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

    this.children.set(id, child);
    this.updateState(id, { status: 'running', pid: child.pid ?? null });

    const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        const logLine = this.logs.append({
          processId: id,
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
      this.children.delete(id);
      const crashed = code !== 0;
      this.updateState(id, {
        status: crashed ? 'crashed' : 'stopped',
        pid: null,
        exitedAt: Date.now(),
        exitCode: code,
      });
      // If convex exits unhealthy, set dependents back to pending if still present
      if (id === 'convex' && crashed) {
        this.updateState('webapp', {
          status: 'pending',
          health: 'unknown',
          healthDetail: 'Convex exited',
        });
        this.updateState('daemon', {
          status: 'pending',
          health: 'unknown',
          healthDetail: 'Convex exited',
        });
      }
    });
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
