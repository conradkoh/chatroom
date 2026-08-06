import type { InboundEvent } from '../entities/inbound-event.js';

export type WorkspaceGitInboundEvent = Extract<
  InboundEvent,
  { type: 'workspace.list-changed' } | { type: 'git.request' }
>;

export type HandleWorkspaceGitInboundDeps = {
  onWorkspaceGitEvent?: (event: WorkspaceGitInboundEvent) => Promise<void>;
};

export async function handleWorkspaceGitInbound(
  deps: HandleWorkspaceGitInboundDeps,
  event: WorkspaceGitInboundEvent
): Promise<void> {
  if (deps.onWorkspaceGitEvent) {
    await deps.onWorkspaceGitEvent(event);
  }
}
