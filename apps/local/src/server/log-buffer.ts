import type { LogLine, ManagedProcessId } from '../shared/protocol.js';

const MAX_LINES = 2000;

export class LogBufferStore {
  private readonly buffers = new Map<ManagedProcessId, LogLine[]>();

  append(line: LogLine): LogLine {
    const buf = this.buffers.get(line.processId) ?? [];
    buf.push(line);
    if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
    this.buffers.set(line.processId, buf);
    return line;
  }

  clear(processId: ManagedProcessId): void {
    this.buffers.set(processId, []);
  }

  clearAll(): void {
    for (const id of ['convex', 'webapp', 'daemon'] as ManagedProcessId[]) {
      this.buffers.set(id, []);
    }
  }

  snapshot(): Record<ManagedProcessId, LogLine[]> {
    return {
      convex: [...(this.buffers.get('convex') ?? [])],
      webapp: [...(this.buffers.get('webapp') ?? [])],
      daemon: [...(this.buffers.get('daemon') ?? [])],
    };
  }
}
