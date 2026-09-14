import type { Doc } from '../../../../convex/_generated/dataModel';

type LaunchRequest = Doc<'chatroom_agentLastSentLaunchRequests'>;
type Workspace = Doc<'chatroom_workspaces'>;

export function normalizeWorkingDir(value: string): string {
  return value.trim().replace(/[/\\]+$/, '');
}

/** Matches legacy launch snapshots to a workspace without trusting role alone. */
export function requestBelongsToWorkspace(request: LaunchRequest, workspace: Workspace): boolean {
  return (
    request.workspaceId === workspace._id ||
    (request.machineId === workspace.machineId &&
      normalizeWorkingDir(request.workingDir) === normalizeWorkingDir(workspace.workingDir))
  );
}
