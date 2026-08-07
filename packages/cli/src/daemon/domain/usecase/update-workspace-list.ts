import type { WorkspaceGitInboundEvent } from './handle-workspace-git-inbound.js';

export interface UpdateWorkspaceListDeps {
  dispatchInbound: (
    event: Extract<WorkspaceGitInboundEvent, { type: 'workspace.list-changed' }>
  ) => Promise<void>;
}

export async function updateWorkspaceList(
  deps: UpdateWorkspaceListDeps,
  event: Extract<WorkspaceGitInboundEvent, { type: 'workspace.list-changed' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
