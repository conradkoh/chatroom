/** @deprecated U14 — use daemon/entry/workspace-git/git-subscription.ts */
export {
  startGitRequestSubscriptionEffect,
  drainPendingGitRequests,
  processRequestsEffect,
  type GitSubscriptionHandle,
  type GitSubscriptionDeps,
  type PendingRequest,
} from '../../../daemon/entry/workspace-git/git-subscription.js';
