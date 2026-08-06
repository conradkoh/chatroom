import { fulfillGitRequest } from '../../domain/usecase/fulfill-git-request.js';
import type { HandleWorkspaceGitInboundDeps } from '../../domain/usecase/handle-workspace-git-inbound.js';
import { syncGitState } from '../../domain/usecase/sync-git-state.js';
import { updateWorkspaceList } from '../../domain/usecase/update-workspace-list.js';
import { dispatchWorkspaceGitInboundEvent } from '../workspace-git-inbound-registry.js';

export function createWorkspaceGitRouterDeps(): HandleWorkspaceGitInboundDeps {
  return {
    deliverInbound: async (event) => {
      switch (event.type) {
        case 'workspace.list-changed':
          await updateWorkspaceList({ dispatchInbound: dispatchWorkspaceGitInboundEvent }, event);
          await syncGitState({ dispatchInbound: dispatchWorkspaceGitInboundEvent }, event);
          break;
        case 'git.request':
          await fulfillGitRequest({ dispatchInbound: dispatchWorkspaceGitInboundEvent }, event);
          break;
      }
    },
  };
}
