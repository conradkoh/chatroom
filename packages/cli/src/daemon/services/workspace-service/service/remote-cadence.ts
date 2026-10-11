// Reason: the WorkspaceService monitor (S4b) is the first production consumer; S5 wires it.
// fallow-ignore-file unused-file
import { computeBackoff } from '../../../../infrastructure/services/workspace/git-workspace-change-source.js';
import type { WorkspaceSyncPolicy } from '../domain/workspace-sync-policy.js';

export type RemoteCadenceInput = {
  now: number;
  /** Epoch ms of the most recent local, tier-up, refresh, or command trigger; null if none. */
  lastTriggerAt: number | null;
  /** Aggregate checks state from the last applied `checks` result; null when there are no runs. */
  checksState: string | null;
  consecutiveFailures: number;
  policy: WorkspaceSyncPolicy['remote'];
};

/**
 * Delay in ms until the next remote poll for one workspace. Pure.
 *
 * Rules are applied in order; the first match wins:
 * 1. Failures back off exponentially from `hotIntervalMs`, capped at `errorBackoffMaxMs`.
 * 2. Pending checks poll at `pendingChecksIntervalMs`.
 * 3. A trigger within `hotWindowMs` polls at `hotIntervalMs`.
 * 4. Otherwise poll at `idleIntervalMs`.
 */
export function nextRemotePollDelayMs(input: RemoteCadenceInput): number {
  const { policy } = input;
  if (input.consecutiveFailures > 0) {
    // Uncapped exponent: the delay doubles until it reaches errorBackoffMaxMs, which is the only cap.
    return computeBackoff(
      input.consecutiveFailures,
      policy.hotIntervalMs,
      policy.errorBackoffMaxMs,
      Infinity
    );
  }
  if (input.checksState === 'pending') return policy.pendingChecksIntervalMs;
  if (isWithinHotWindow(input)) return policy.hotIntervalMs;
  return policy.idleIntervalMs;
}

/**
 * True when a trigger happened strictly less than `hotWindowMs` ago. A trigger exactly
 * `hotWindowMs` ago is outside the window.
 */
function isWithinHotWindow(input: RemoteCadenceInput): boolean {
  const { lastTriggerAt, now, policy } = input;
  return lastTriggerAt !== null && now - lastTriggerAt < policy.hotWindowMs;
}

/**
 * True when a result captured at poll start still describes the current branch and HEAD.
 * Constraint (I4): a remote result is applied only when both values are unchanged since the
 * poll started; otherwise it is discarded so it cannot be published against a newer HEAD.
 */
export function isRemoteResultCurrent(
  captured: { branch: string; oid: string },
  current: { branch: string; oid: string }
): boolean {
  return captured.branch === current.branch && captured.oid === current.oid;
}
