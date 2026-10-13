import { GIT_CLONE_ERROR_CODES, GIT_CLONE_STATUSES } from '@workspace/shared/domain/git-clone';
import { v } from 'convex/values';

export const gitCloneErrorCodeValidator = v.union(
  ...GIT_CLONE_ERROR_CODES.map((c) => v.literal(c))
);

export const gitCloneStatusValidator = v.union(...GIT_CLONE_STATUSES.map((s) => v.literal(s)));
