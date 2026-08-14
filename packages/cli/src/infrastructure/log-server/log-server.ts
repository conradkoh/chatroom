import type { DatabaseSync } from 'node:sqlite';

import { appendChatroomLogBatch, type ChatroomLogEntry } from './chatroom-log-store.js';
import { appendBatch, type LogEntry } from './log-store.js';
import { openLogDatabase } from './open-log-database.js';

export interface AgentLogSink {
  write(entry: LogEntry): void;
}

export interface ChatroomLogSink {
  writeChatroomLog(entry: ChatroomLogEntry): void;
}

export type LogServer = AgentLogSink &
  ChatroomLogSink & { flush(): void; close(): void; db: DatabaseSync };

export function createLogServer(
  dbPath: string,
  opts: {
    onWrite?: (entry: LogEntry) => void;
    onChatroomLogWrite?: (entry: ChatroomLogEntry) => void;
  } = {}
): LogServer {
  const db = openLogDatabase(dbPath);
  let pending: LogEntry[] = [];
  let pendingChatroom: ChatroomLogEntry[] = [];
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flushLogEntries = () => {
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

  const flushChatroomLogs = () => {
    if (!pendingChatroom.length) return;
    const batch = pendingChatroom;
    try {
      appendChatroomLogBatch(db, batch);
      pendingChatroom = [];
    } catch (e) {
      pendingChatroom = batch;
      throw e;
    }
  };

  const flush = () => {
    flushLogEntries();
    flushChatroomLogs();
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
      if (pending.length >= 50) flushLogEntries();
      else schedule();
    },
    writeChatroomLog(entry) {
      opts.onChatroomLogWrite?.(entry);
      pendingChatroom.push(entry);
      if (pendingChatroom.length >= 50) flushChatroomLogs();
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
