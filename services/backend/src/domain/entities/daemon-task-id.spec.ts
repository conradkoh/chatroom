import { describe, expect, test } from 'vitest';

import {
  asDaemonTaskId,
  createDaemonTaskId,
  isDaemonTaskId,
  isDaemonLocalTaskId,
} from './daemon-task-id';

describe('daemon-task-id', () => {
  test('createDaemonTaskId returns a valid UUID v4', () => {
    const id = createDaemonTaskId();
    expect(isDaemonTaskId(id)).toBe(true);
  });

  test('isDaemonTaskId rejects Convex document ids (no dashes)', () => {
    expect(isDaemonTaskId('jd7abc123def456')).toBe(false);
  });

  test('isDaemonLocalTaskId is an alias for isDaemonTaskId', () => {
    const id = createDaemonTaskId();
    expect(isDaemonLocalTaskId(id)).toBe(true);
  });

  test('asDaemonTaskId throws on invalid input', () => {
    expect(() => asDaemonTaskId('not-a-uuid')).toThrow(/Invalid DaemonTaskId/);
  });
});
