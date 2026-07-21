import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { LogBufferStore } from './log-buffer.js';
import type { ProcessDefinition } from './process-definitions.js';
import type { LogLine, ManagedProcessId, ProcessInfo } from '../shared/protocol.js';

type ManagerEvents = {
  process: [ProcessInfo];
  log: [LogLine];
};

export class ProcessManager extends EventEmitter<ManagerEvents> {
  private readonly definitions: ProcessDefinition[];
  private readonly logs = new LogBufferStore();
  private readonly children = new Map<ManagedProcessId, ChildProcess>();
  private readonly state = new Map<ManagedProcessId, ProcessInfo>();

  constructor(definitions: ProcessDefinition[]) {
    super();
    this.definitions = definitions;
    for (const def of definitions) {
      this.state.set(def.id, {
        id: def.id,
        name: def.name,
        status: 'stopped',
        pid: null,
        startedAt: null,
        exitedAt: null,
        exitCode: null,
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
    for (const def of this.definitions) {
      this.start(def.id);
    }
  }

  restart(id: ManagedProcessId): void {
    this.stop(id);
    this.start(id);
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
      this.updateState(id, {
        status: code === 0 ? 'stopped' : 'crashed',
        pid: null,
        exitedAt: Date.now(),
        exitCode: code,
      });
    });
  }

  private updateState(id: ManagedProcessId, patch: Partial<ProcessInfo>): void {
    const current = this.state.get(id);
    if (!current) return;
    const next = { ...current, ...patch };
    this.state.set(id, next);
    this.emit('process', next);
  }
}
