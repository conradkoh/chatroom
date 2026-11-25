/**
 * Chatroom export read — stall guard.
 *
 * A page that reports more work but returns no rows would make the driver loop
 * forever. `assertNotStalled` is pure, so this failure is provable without a
 * database; the paged path itself is covered through `chatroomExport.spec.ts`
 * and the driver spec.
 */

import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';

import { assertNotStalled } from './export-read';

function stallCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  return (error.data as { code?: string }).code;
}

describe('assertNotStalled', () => {
  test('throws EXPORT_PAGE_STALLED when an unfinished page has no rows', () => {
    try {
      assertNotStalled({ rows: [], isDone: false }, 'messages');
      expect.unreachable('assertNotStalled should have thrown');
    } catch (error) {
      expect(stallCode(error)).toBe('EXPORT_PAGE_STALLED');
    }
  });

  test('accepts an empty final page', () => {
    expect(() => assertNotStalled({ rows: [], isDone: true }, 'messages')).not.toThrow();
  });

  test('accepts a non-empty unfinished page', () => {
    expect(() => assertNotStalled({ rows: [{}], isDone: false }, 'tasks')).not.toThrow();
  });
});
