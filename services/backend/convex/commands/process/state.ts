import { isTerminal } from '../fsm';
import type { CommandRunStatus } from '../types';

export type RunId = any;

export function buildStatusUpdate(
  status: CommandRunStatus,
  extras?: { pid?: number; exitCode?: number; terminationReason?: string }
): Record<string, unknown> {
  const update: Record<string, unknown> = { status };
  if (extras) {
    if (extras.pid !== undefined) update.pid = extras.pid;
    if (extras.exitCode !== undefined) update.exitCode = extras.exitCode;
    if (extras.terminationReason !== undefined) update.terminationReason = extras.terminationReason;
  }
  if (isTerminal(status)) {
    update.completedAt = Date.now();
  }
  return update;
}
