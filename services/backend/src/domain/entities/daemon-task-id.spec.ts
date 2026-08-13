import { describe, expect, test } from 'vitest';

import {
  asDaemonTaskId,
  createDaemonTaskId,
  isDaemonTaskId,
  isDaemonLocalTaskId,
  resolveCanonicalTaskId,
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

describe('resolveCanonicalTaskId', () => {
  test('prefers daemonTaskId when valid', () => {
    const daemonTaskId = createDaemonTaskId();
    expect(resolveCanonicalTaskId({ _id: 'convex-id', daemonTaskId })).toBe(daemonTaskId);
  });

  test('falls back to _id when daemonTaskId missing', () => {
    expect(resolveCanonicalTaskId({ _id: 'convex-id' })).toBe('convex-id');
  });

  test('falls back to _id when daemonTaskId invalid', () => {
    expect(resolveCanonicalTaskId({ _id: 'convex-id', daemonTaskId: 'bad' })).toBe('convex-id');
  });
});
