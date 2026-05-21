import type { ChildProcess } from 'node:child_process';

export interface RunningProcess {
  process: ChildProcess;
  runId: string;
  commandKey: string;
  outputBuffer: string;
  chunkIndex: number;
  flushTimer: ReturnType<typeof setInterval>;
  softTimeoutTimer: ReturnType<typeof setTimeout> | null;
  terminationIntent: 'killed' | 'stopped' | null;
}

export const TERMINAL_STATES = new Set<string>(['completed', 'failed', 'stopped', 'killed']);

export const PENDING_STOP_TTL_MS = 60_000;

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
