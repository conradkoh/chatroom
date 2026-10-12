export {
  createWorkspaceService,
  type WorkspaceRefreshReason,
  type WorkspaceService,
  type WorkspaceServiceOutbox,
} from './service/workspace-service.js';
export {
  createWorkspaceActivitySource,
  type ConvexWsClientLike,
} from './infrastructure/workspace-activity-source.js';
export { DEFAULT_WORKSPACE_SYNC_POLICY } from './domain/workspace-sync-policy.js';
