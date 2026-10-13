import type { Doc } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it } from 'vitest';

import { deriveGitCloneViewState } from './deriveGitCloneViewState';

// The spec values, pinned here so a change to the module's constants is a deliberate test change.
const GIT_CLONE_PICKUP_TIMEOUT_MS = 5 * 60_000;
const GIT_CLONE_STALL_MS = 2 * 60_000;

const CREATED_AT = 1_000_000;

function makeRequest(overrides: Partial<Doc<'chatroom_gitCloneRequests'>>) {
  return {
    _id: 'req-1',
    _creationTime: CREATED_AT,
    userId: 'user-1',
    machineId: 'machine-1',
    repoUrl: 'https://github.com/acme/repo.git',
    targetPath: '/Users/me/src/repo',
    status: 'pending',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  } as Doc<'chatroom_gitCloneRequests'>;
}

describe('deriveGitCloneViewState', () => {
  it('is idle before any request has been started', () => {
    expect(deriveGitCloneViewState(undefined, CREATED_AT, true, false)).toEqual({ kind: 'idle' });
  });

  it('is waiting while the request is still loading', () => {
    expect(deriveGitCloneViewState(undefined, CREATED_AT, true, true)).toEqual({
      kind: 'waiting',
      offline: false,
    });
  });

  it('reports the machine as offline while waiting if it is not connected', () => {
    expect(deriveGitCloneViewState(undefined, CREATED_AT, false, true)).toEqual({
      kind: 'waiting',
      offline: true,
    });
  });

  it('fails with an unknown error when the request is missing or not visible', () => {
    expect(deriveGitCloneViewState(null, CREATED_AT, true, true)).toMatchObject({
      kind: 'failed',
      errorCode: 'unknown',
    });
  });

  it('is waiting for a pending request that is within the pickup window', () => {
    const request = makeRequest({ status: 'pending' });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toEqual({
      kind: 'waiting',
      offline: false,
    });
  });

  it('times out exactly at the pickup timeout, which is not yet expired', () => {
    const request = makeRequest({ status: 'pending' });
    const now = CREATED_AT + GIT_CLONE_PICKUP_TIMEOUT_MS;
    expect(deriveGitCloneViewState(request, now, true, true)).toEqual({
      kind: 'waiting',
      offline: false,
    });
  });

  it('times out one millisecond past the pickup timeout', () => {
    const request = makeRequest({ status: 'pending' });
    const now = CREATED_AT + GIT_CLONE_PICKUP_TIMEOUT_MS + 1;
    expect(deriveGitCloneViewState(request, now, true, true)).toEqual({ kind: 'timed_out' });
  });

  it('reports cloning progress with the phase and percent', () => {
    const request = makeRequest({
      status: 'cloning',
      updatedAt: CREATED_AT,
      progressPhase: 'Receiving objects',
      progressPercent: 42,
    });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toEqual({
      kind: 'cloning',
      phase: 'Receiving objects',
      percent: 42,
    });
  });

  it('uses an empty phase and null percent when the daemon has not reported them yet', () => {
    const request = makeRequest({ status: 'cloning', updatedAt: CREATED_AT });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toEqual({
      kind: 'cloning',
      phase: '',
      percent: null,
    });
  });

  it('is not stalled exactly at the stall threshold', () => {
    const request = makeRequest({ status: 'cloning', updatedAt: CREATED_AT });
    const now = CREATED_AT + GIT_CLONE_STALL_MS;
    expect(deriveGitCloneViewState(request, now, true, true)).toMatchObject({ kind: 'cloning' });
  });

  it('is stalled one millisecond past the stall threshold', () => {
    const request = makeRequest({ status: 'cloning', updatedAt: CREATED_AT });
    const now = CREATED_AT + GIT_CLONE_STALL_MS + 1;
    expect(deriveGitCloneViewState(request, now, true, true)).toEqual({ kind: 'stalled' });
  });

  it('completes with the target path as the cloned path', () => {
    const request = makeRequest({
      status: 'completed',
      targetPath: '/Users/me/src/repo',
    });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toEqual({
      kind: 'completed',
      clonedPath: '/Users/me/src/repo',
    });
  });

  it('fails with the error code, its shared message, and the raw detail', () => {
    const request = makeRequest({
      status: 'failed',
      errorCode: 'auth',
      errorMessage: 'fatal: Authentication failed',
    });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toEqual({
      kind: 'failed',
      errorCode: 'auth',
      message: expect.stringContaining('Authentication failed'),
      detail: 'fatal: Authentication failed',
    });
  });

  it('falls back to the unknown error code when a failed request has none', () => {
    const request = makeRequest({ status: 'failed' });
    expect(deriveGitCloneViewState(request, CREATED_AT, true, true)).toMatchObject({
      kind: 'failed',
      errorCode: 'unknown',
    });
  });
});
