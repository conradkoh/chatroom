/**
 * Git infrastructure — public API.
 *
 * Re-exports all types and reader functions from the git sub-module.
 */

export type {
  GitDiffStat,
  GitCommit,
  GitBranchResult,
  GitDiffStatResult,
  GitFullDiffResult,
  GitCommitDetailResult,
} from './types.js';

export { FULL_DIFF_MAX_BYTES } from './types.js';

export {
  isGitRepo,
  getBranch,
  isDirty,
  getDiffStat,
  getFullDiff,
  getRecentCommits,
  getCommitDetail,
} from './git-reader.js';
