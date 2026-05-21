import { ConvexError } from 'convex/values';
import { BACKEND_ERROR_CODES } from '../../config/errorCodes';

export type CommandRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'killed';

export const TERMINAL_STATES: ReadonlySet<CommandRunStatus> = new Set<CommandRunStatus>([
  'completed',
  'failed',
  'stopped',
  'killed',
]);

const VALID_TRANSITIONS: Record<CommandRunStatus, ReadonlySet<CommandRunStatus>> = {
  pending: new Set(['running', 'failed', 'stopped', 'killed']),
  running: new Set(['completed', 'failed', 'stopped', 'killed']),
  completed: new Set(),
  failed: new Set(),
  stopped: new Set(),
  killed: new Set(),
};

export function isTerminal(status: CommandRunStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export function isValidTransition(from: CommandRunStatus, to: CommandRunStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export function assertValidTransition(from: CommandRunStatus, to: CommandRunStatus): void {
  if (!isValidTransition(from, to)) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.INVALID_RUN_STATE_TRANSITION,
      message: `Invalid run status transition: ${from} → ${to}`,
    });
  }
}
