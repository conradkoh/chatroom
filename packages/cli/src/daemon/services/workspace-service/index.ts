export {
  createWorkspaceService,
  type WorkspaceAgentPresenceSource,
  type WorkspaceRefreshReason,
  type WorkspaceService,
  type WorkspaceServiceOutbox,
} from './service/workspace-service.js';
export {
  createWorkspaceMembershipSource,
  type ConvexWsClientLike,
} from './infrastructure/workspace-membership-source.js';
export { DEFAULT_WORKSPACE_SYNC_POLICY } from './domain/workspace-sync-policy.js';
