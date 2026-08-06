import type { WorkspaceGitInboundEvent } from '../domain/usecase/handle-workspace-git-inbound.js';

export type WorkspaceGitInboundHandler = (event: WorkspaceGitInboundEvent) => Promise<void>;

let handler: WorkspaceGitInboundHandler | undefined;

export function registerWorkspaceGitInboundHandler(h: WorkspaceGitInboundHandler): void {
  handler = h;
}

export function unregisterWorkspaceGitInboundHandler(): void {
  handler = undefined;
}

export async function dispatchWorkspaceGitInboundEvent(
  event: WorkspaceGitInboundEvent
): Promise<void> {
  if (handler) await handler(event);
}
