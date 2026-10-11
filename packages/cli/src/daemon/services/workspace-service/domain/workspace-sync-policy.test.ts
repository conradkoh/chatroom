import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_SYNC_POLICY,
  resolveWorkspaceSyncPolicy,
} from './workspace-sync-policy.js';

describe('resolveWorkspaceSyncPolicy', () => {
  it('returns the defaults when called without overrides', () => {
    expect(resolveWorkspaceSyncPolicy()).toEqual(DEFAULT_WORKSPACE_SYNC_POLICY);
  });

  it('deep-merges nested overrides and keeps the untouched leaves', () => {
    const policy = resolveWorkspaceSyncPolicy({
      probeIntervalMs: 50,
      remote: { hotIntervalMs: 1 },
      outbox: { minIntervalMsByKind: { worktree: 0 } },
    });

    expect(policy.probeIntervalMs).toBe(50);
    expect(policy.remote).toEqual({
      ...DEFAULT_WORKSPACE_SYNC_POLICY.remote,
      hotIntervalMs: 1,
    });
    expect(policy.outbox.minIntervalMsByKind).toEqual({
      ...DEFAULT_WORKSPACE_SYNC_POLICY.outbox.minIntervalMsByKind,
      worktree: 0,
    });
    expect(policy.outbox.retryDelayMs).toBe(DEFAULT_WORKSPACE_SYNC_POLICY.outbox.retryDelayMs);
  });

  it('never mutates the defaults, including when the result is edited', () => {
    const before = structuredClone(DEFAULT_WORKSPACE_SYNC_POLICY);
    const policy = resolveWorkspaceSyncPolicy({ remote: { minGapMs: 0 } });
    policy.remote.idleIntervalMs = 1;
    policy.outbox.minIntervalMsByKind.head = 999;

    expect(DEFAULT_WORKSPACE_SYNC_POLICY).toEqual(before);
  });

  it('returns a fresh object tree on every call', () => {
    const a = resolveWorkspaceSyncPolicy();
    const b = resolveWorkspaceSyncPolicy();
    expect(a).not.toBe(b);
    expect(a.remote).not.toBe(b.remote);
    expect(a.outbox.minIntervalMsByKind).not.toBe(
      DEFAULT_WORKSPACE_SYNC_POLICY.outbox.minIntervalMsByKind
    );
  });
});
