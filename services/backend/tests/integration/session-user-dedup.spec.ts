/**
 * Session auth — user-doc read dedup (Integration Tests)
 *
 * Locks in the optimization where `validateSession` surfaces the user document
 * it already loads so `getSession` can reuse it instead of issuing a second
 * identical `ctx.db.get('users', ...)` on every authenticated call.
 */

import { describe, expect, test, vi } from 'vitest';

import { getSession } from '../../convex/auth/core/session';
import { validateSession } from '../../convex/auth/core/sessionValidation';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

describe('session auth user-doc dedup', () => {
  test('validateSession surfaces the loaded user doc', async () => {
    const { sessionId } = await createTestSession('auth-dedup-validate');

    const result = await t.run((ctx) => validateSession(ctx, sessionId));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user).toBeDefined();
      expect(result.user._id).toBe(result.userId);
    }
  });

  test('getSession reads the users table only once per call', async () => {
    const { sessionId } = await createTestSession('auth-dedup-count');

    const userReads = await t.run(async (ctx) => {
      // Spy preserves the original implementation (calls through) and lets us
      // count how many times the users table is read during one getSession call.
      const spy = vi.spyOn(ctx.db, 'get');

      const auth = await getSession(ctx, sessionId);
      expect(auth).not.toBeNull();
      expect(auth?.user._id).toBe(auth?.userId);

      const reads = spy.mock.calls.filter((call) => call[0] === 'users').length;
      spy.mockRestore();
      return reads;
    });

    // Pre-optimization this was 2 (once in validateSession, once in getSession).
    expect(userReads).toBe(1);
  });
});
