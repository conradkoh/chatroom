import type { CommandRun } from '../../../features/run-command/types/run';

/**
 * isActiveRun — returns true when a run is currently executing or about to execute.
 * Replaces the inline `status === 'running' || status === 'pending'` pattern.
 */
export function isActiveRun(status: CommandRun['status'] | null | undefined): boolean {
  return status === 'running' || status === 'pending';
}
