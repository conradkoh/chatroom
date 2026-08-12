import type { DatabaseSync } from 'node:sqlite';

import { appendBatch, type LogEntry } from './log-store.js';
import { openLogDatabase } from './open-log-database.js';

export interface AgentLogSink {
  write(entry: LogEntry): void;
}
export type LogServer = AgentLogSink & { flush(): void; close(): void; db: DatabaseSync };
export function createLogServer(dbPath: string, opts: { onWrite?: (entry: LogEntry) => void } = {}): LogServer {
  const db = openLogDatabase(dbPath);
  let pending: LogEntry[] = [];
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (!pending.length) return;
    const batch = pending;
    try {
      appendBatch(db, batch);
      pending = [];
      retries = 0;
    } catch (e) {
      pending = batch;
      if (++retries >= 3) throw e;
    }
  };
  const schedule = () => {
    if (!timer)
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, 100);
  };
  return {
    db,
    write(e) {
      opts.onWrite?.(e);
      pending.push(e);
      if (pending.length >= 50) flush();
      else schedule();
    },
    flush,
    close() {
      if (timer) clearTimeout(timer);
      flush();
      db.close();
    },
  };
}
