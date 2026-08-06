/** @deprecated U14 — use v2/entry/workspace-git/git-subscription.ts */
export {
  startGitRequestSubscriptionEffect,
  drainPendingGitRequests,
  processRequestsEffect,
  type GitSubscriptionHandle,
  type GitSubscriptionDeps,
  type PendingRequest,
} from '../../../v2/entry/workspace-git/git-subscription.js';
