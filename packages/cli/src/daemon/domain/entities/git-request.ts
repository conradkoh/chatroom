export const GIT_REQUEST_TYPES = [
  'full_diff',
  'commit_detail',
  'more_commits',
  'pr_diff',
  'pr_action',
  'pr_commits',
  'all_pull_requests',
  'recent_commits',
] as const;

export type GitRequestType = (typeof GIT_REQUEST_TYPES)[number];

export const GIT_PR_ACTIONS = ['merge_squash', 'merge_no_squash', 'close'] as const;
export type GitPrAction = (typeof GIT_PR_ACTIONS)[number];

export type GitRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GitRequest {
  requestId: string;
  machineId: string;
  workingDir: string;
  requestType: GitRequestType;
  status: GitRequestStatus;
  sha?: string | undefined;
  offset?: number | undefined;
  baseBranch?: string | undefined;
  prAction?: GitPrAction | undefined;
  prNumber?: number | undefined;
}

export function isGitRequestType(value: string): value is GitRequestType {
  return (GIT_REQUEST_TYPES as readonly string[]).includes(value);
}
