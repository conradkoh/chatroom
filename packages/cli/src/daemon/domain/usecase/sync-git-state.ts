import type { WorkspaceGitInboundEvent } from './handle-workspace-git-inbound.js';

export interface SyncGitStateDeps {
  dispatchInbound: (
    event: Extract<WorkspaceGitInboundEvent, { type: 'workspace.list-changed' }>
  ) => Promise<void>;
}

export async function syncGitState(
  deps: SyncGitStateDeps,
  event: Extract<WorkspaceGitInboundEvent, { type: 'workspace.list-changed' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
