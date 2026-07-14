import type { GitBranchResult } from './types.js';

export function isGitBranchAvailable(
  result: GitBranchResult
): result is Extract<GitBranchResult, { status: 'available' }> {
  return result.status === 'available';
}

export function isGitBranchError(
  result: GitBranchResult
): result is Extract<GitBranchResult, { status: 'error' }> {
  return result.status === 'error';
}

export function isGitBranchNotFound(
  result: GitBranchResult
): result is Extract<GitBranchResult, { status: 'not_found' }> {
  return result.status === 'not_found';
}

export function isGitContentAvailable<T extends { status: string }>(
  result: T
): result is T & { status: 'available' | 'truncated' } {
  return result.status === 'available' || result.status === 'truncated';
}
