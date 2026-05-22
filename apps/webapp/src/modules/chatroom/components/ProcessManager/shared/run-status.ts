import type { CommandRun } from '../ProcessManager';

/**
 * isActiveRun — returns true when a run is currently executing or about to execute.
 * Replaces the inline `status === 'running' || status === 'pending'` pattern.
 */
export function isActiveRun(status: CommandRun['status'] | null | undefined): boolean {
  return status === 'running' || status === 'pending';
}
