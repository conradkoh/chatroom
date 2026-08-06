import type { WorkspaceGitInboundEvent } from './handle-workspace-git-inbound.js';

export interface FulfillGitRequestDeps {
  dispatchInbound: (
    event: Extract<WorkspaceGitInboundEvent, { type: 'git.request' }>
  ) => Promise<void>;
}

export async function fulfillGitRequest(
  deps: FulfillGitRequestDeps,
  event: Extract<WorkspaceGitInboundEvent, { type: 'git.request' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
