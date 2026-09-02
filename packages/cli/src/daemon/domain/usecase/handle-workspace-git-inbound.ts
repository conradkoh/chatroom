import type { InboundEvent } from '../entities/inbound-event.js';

export type WorkspaceGitInboundEvent = Extract<
  InboundEvent,
  { type: 'workspace.list-changed' } | { type: 'git.request' }
>;

export type HandleWorkspaceGitInboundDeps = {
  deliverInbound?:( (event: WorkspaceGitInboundEvent) => Promise<void>) | undefined;
};

export async function handleWorkspaceGitInbound(
  deps: HandleWorkspaceGitInboundDeps,
  event: WorkspaceGitInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
