// fallow-ignore-next-line unused-export
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
// fallow-ignore-next-line unused-type
export type GitRequestType = (typeof GIT_REQUEST_TYPES)[number];

// fallow-ignore-next-line unused-export
export const GIT_PR_ACTIONS = ['merge_squash', 'merge_no_squash', 'close'] as const;
export type GitPrAction = (typeof GIT_PR_ACTIONS)[number];
