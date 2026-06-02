import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  FileResumeSnapshotStore,
  InMemoryResumeSnapshotStore,
  resumeSnapshotKey,
  type ResumeSnapshot,
} from './resume-snapshot-store.js';

const SAMPLE_SNAPSHOT: ResumeSnapshot = {
  sessionId: 'sess-1',
  machineId: 'm1',
  chatroomId: 'c1',
  role: 'builder',
  agentName: 'build',
  model: 'anthropic/claude-sonnet-4',
  workingDir: '/tmp/test',
  updatedAt: '2026-04-25T00:00:00.000Z',
};

describe('resumeSnapshotKey', () => {
  it('joins machineId, chatroomId, and role', () => {
    expect(resumeSnapshotKey('m1', 'c1', 'builder')).toBe('m1:c1:builder');
  });
});

describe('InMemoryResumeSnapshotStore', () => {
  let store: InMemoryResumeSnapshotStore;

  beforeEach(() => {
    store = new InMemoryResumeSnapshotStore();
  });

  it('returns undefined for absent snapshot', () => {
    expect(store.get('m1', 'c1', 'builder')).toBeUndefined();
  });

  it('stores and retrieves by chatroom+role key', () => {
    store.upsert(SAMPLE_SNAPSHOT);
    expect(store.get('m1', 'c1', 'builder')).toEqual(SAMPLE_SNAPSHOT);
  });

  it('overwrites existing snapshot for the same key', () => {
    store.upsert(SAMPLE_SNAPSHOT);
    const updated = { ...SAMPLE_SNAPSHOT, sessionId: 'sess-2' };
    store.upsert(updated);
    expect(store.get('m1', 'c1', 'builder')).toEqual(updated);
  });

  it('removes snapshot by key', () => {
    store.upsert(SAMPLE_SNAPSHOT);
    store.remove('m1', 'c1', 'builder');
    expect(store.get('m1', 'c1', 'builder')).toBeUndefined();
  });
});

describe('FileResumeSnapshotStore', () => {
  const tmpDir = join(tmpdir(), `chatroom-resume-test-${Date.now()}`);
  const tmpFile = join(tmpDir, 'opencode-sdk-resume-snapshots.json');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists snapshot to disk', () => {
    const store = new FileResumeSnapshotStore(tmpFile);
    store.upsert(SAMPLE_SNAPSHOT);
    expect(store.get('m1', 'c1', 'builder')).toEqual(SAMPLE_SNAPSHOT);
  });

  it('reads existing on-disk data', () => {
    const key = resumeSnapshotKey('m1', 'c1', 'builder');
    writeFileSync(tmpFile, JSON.stringify({ [key]: SAMPLE_SNAPSHOT }));

    const store = new FileResumeSnapshotStore(tmpFile);
    expect(store.get('m1', 'c1', 'builder')).toEqual(SAMPLE_SNAPSHOT);
  });
});
