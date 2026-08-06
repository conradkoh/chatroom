/**
 * Git infrastructure — public API.
 *
 * Re-exports all types and functions from the git sub-module.
 */

export type {
  DiffStat,
  GitCommit,
  GitBranchResult,
  GitDiffStatResult,
  GitFullDiffResult,
  GitCommitDetailResult,
  GitDiscardResult,
  GitPullResult,
} from './types.js';

export {
  isGitRepo,
  getBranch,
  isDirty,
  getDiffStat,
  getFullDiff,
  getRecentCommits,
  getCommitDetail,
  parseDiffStatLine,
} from './git-reader.js';

export { discardFile, discardAllChanges, gitPull, gitPush, gitSync } from './git-writer.js';
