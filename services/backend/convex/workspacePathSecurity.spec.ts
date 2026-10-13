import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { normalizeWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';

/** The value thrown by `fn`, or undefined when it returns normally. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('normalizeWorkingDir', () => {
  it.each(['/', '///'])('rejects the filesystem root %j with INVALID_WORKING_DIR', (workingDir) => {
    const error = thrownBy(() => normalizeWorkingDir(workingDir));

    expect(error).toBeInstanceOf(ConvexError);
    expect(error).toMatchObject({ data: { code: BACKEND_ERROR_CODES.INVALID_WORKING_DIR } });
  });

  it('strips trailing slashes from a non-root path', () => {
    expect(normalizeWorkingDir('/a/')).toBe('/a');
  });
});
