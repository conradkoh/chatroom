/**
 * Copy and classification for the switch-workspace flow.
 *
 * Pure functions only: the stage machine (`useSwitchWorkspaceFlow`) and the step components
 * import from here instead of each other.
 */

import type { ConfigSkipReason } from '@workspace/backend/src/domain/usecase/workspace/switch-chatroom-workspace';

import {
  copyForErrorCode,
  getConvexErrorCode,
  getMachineErrorCopy,
} from '@/modules/chatroom/features/machines/lib/machineErrorCopy';

export type SwitchErrorKind = 'conflict' | 'invalid-path' | 'machine' | 'generic';

export interface SwitchError {
  kind: SwitchErrorKind;
  message: string;
}

export const CONFLICT_COPY =
  "This chatroom's workspace changed since you opened this dialog. Nothing was switched. Review the current workspace, then try again.";

/** Maps a thrown switch error to a UI kind and copy. Never throws. */
// fallow-ignore-next-line complexity
export function classifySwitchError(error: unknown): SwitchError {
  const code = getConvexErrorCode(error);
  if (code === 'WORKSPACE_SWITCH_CONFLICT' || code === 'WORKSPACE_ALREADY_BOUND') {
    return { kind: 'conflict', message: CONFLICT_COPY };
  }
  if (code === 'INVALID_WORKING_DIR') {
    return {
      kind: 'invalid-path',
      message: copyForErrorCode(code) ?? "That path isn't valid. Use an absolute folder path.",
    };
  }
  if (code === 'MACHINE_NOT_FOUND' || code === 'NOT_AUTHORIZED_MACHINE') {
    return { kind: 'machine', message: getMachineErrorCopy(error, 'This machine is unavailable.') };
  }
  return {
    kind: 'generic',
    message: getMachineErrorCopy(error, 'Could not switch the workspace. Try again.'),
  };
}

export const SKIP_REASON_COPY: Record<ConfigSkipReason, string> = {
  harness_unavailable: 'Harness not available on the new machine',
  target_has_config: 'The new workspace already has a configuration for this role',
  not_remote: 'Not a remote agent, so nothing to carry over',
};

export function stopSummaryLine(agentsStopRequested: boolean): string {
  return agentsStopRequested
    ? 'Stop requested for agents on the previous workspace.'
    : 'No agents were running on the previous workspace.';
}

export const NOT_STARTED_LINE = 'Agents were not started on the new workspace.';
export const UNCHANGED_LINE =
  'Already the current workspace. Nothing was changed and no agents were stopped.';

/** Trims whitespace and trailing slashes. A lone "/" stays "/". */
export function normalizeWorkingDir(dir: string): string {
  return dir.trim().replace(/\/+$/, '') || '/';
}

/** Convenience pre-check only. The backend returns `unchanged` regardless. */
export function isSameWorkspace(
  a: { machineId: string | null; workingDir: string },
  b: { machineId: string; workingDir: string }
): boolean {
  return (
    a.machineId === b.machineId &&
    normalizeWorkingDir(a.workingDir) === normalizeWorkingDir(b.workingDir)
  );
}
