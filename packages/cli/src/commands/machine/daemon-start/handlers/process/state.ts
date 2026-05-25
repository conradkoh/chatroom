import type { ChildProcess } from 'node:child_process';

import type { OutputStore } from './output-store';

export interface RunningProcess {
  process: ChildProcess;
  runId: string;
  commandKey: string;
  store: OutputStore;
  startedAt: number;
  flushTimer: ReturnType<typeof setInterval>;
  softTimeoutTimer: ReturnType<typeof setTimeout> | null;
  terminationIntent: 'killed' | 'stopped' | null;
}

export const TERMINAL_STATES = new Set<string>(['completed', 'failed', 'stopped', 'killed']);

export const PENDING_STOP_TTL_MS = 60_000;
export const SIGTERM_GRACE_PERIOD_MS = 5_000;
export const SOFT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const OUTPUT_FLUSH_INTERVAL_MS = 3_000;
export const MAX_BUFFER_SIZE = 100 * 1024;

export function deriveTerminalStatus(
  code: number | null,
  signal: NodeJS.Signals | null,
  terminationIntent: 'killed' | 'stopped' | null
): 'completed' | 'failed' | 'stopped' | 'killed' {
  if (terminationIntent !== null) return terminationIntent;
  if (code === 0) return 'completed';
  if (signal !== null) return 'stopped';
  return 'failed';
}
