/**
 * Git Clone Requests — Integration Tests
 *
 * Covers request, get, reportProgress, reportResult, and end-to-end delivery of
 * daemon.gitClone via the machine command inbox.
 */

import { describe, expect, test } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];

const REPO_URL = 'https://github.com/acme/my-repo.git';
const TARGET_PATH = '/Users/test/src/my-repo';

/** Stable identifier fragment for per-case test users and machines. */
function slug(label: string): string {
  return label.replace(/\W+/g, '-');
}

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

async function requestClone(
  sessionId: SessionId,
  machineId: string,
  overrides: { repoUrl?: string; targetPath?: string } = {}
) {
  return t.mutation(api.gitCloneRequests.request, {
    sessionId,
    machineId,
    repoUrl: overrides.repoUrl ?? REPO_URL,
    targetPath: overrides.targetPath ?? TARGET_PATH,
  });
}

async function getRequest(sessionId: SessionId, requestId: Id<'chatroom_gitCloneRequests'>) {
  return t.query(api.gitCloneRequests.get, { sessionId, requestId });
}

describe('git clone requests', () => {
  test('request creates a pending row and one daemon.gitClone inbox command', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-create', 'machine-gc-create');

    const { requestId } = await requestClone(sessionId, machineId, {
      targetPath: `${TARGET_PATH}/`,
    });

    const row = await getRequest(sessionId, requestId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.machineId).toBe(machineId);
    expect(row!.repoUrl).toBe(REPO_URL);
    expect(row!.targetPath).toBe(TARGET_PATH);

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.gitClone');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.command).toEqual({
      type: 'daemon.gitClone',
      requestId,
      repoUrl: REPO_URL,
      targetPath: TARGET_PATH,
    });
  });

  test('request stores the trimmed, validated repo URL', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-trim', 'machine-gc-trim');

    const { requestId } = await requestClone(sessionId, machineId, {
      repoUrl: '  git@github.com:acme/my-repo.git  ',
    });

    const row = await getRequest(sessionId, requestId);
    expect(row!.repoUrl).toBe('git@github.com:acme/my-repo.git');
  });

  test.each([
    ['ext:: transport', 'ext::sh-c'],
    ['leading dash', '-uhttps://github.com/acme/repo.git'],
    ['file scheme', 'file:///tmp/repo'],
    ['local path', '/tmp/repo'],
  ])('request rejects a repo URL with %s', async (_label, repoUrl) => {
    const key = slug(_label);
    const { sessionId, machineId } = await setupMachine(
      `test-gc-url-${key}`,
      `machine-gc-url-${key}`
    );

    await expect(requestClone(sessionId, machineId, { repoUrl })).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.INVALID_REPO_URL },
    });

    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitClone')).toHaveLength(0);
  });

  test.each([
    ['relative target', 'relative/path/repo'],
    ['tilde target', '~/src/my-repo'],
  ])('request rejects a %s', async (_label, targetPath) => {
    const key = slug(_label);
    const { sessionId, machineId } = await setupMachine(
      `test-gc-target-${key}`,
      `machine-gc-target-${key}`
    );

    await expect(requestClone(sessionId, machineId, { targetPath })).rejects.toThrow();

    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitClone')).toHaveLength(0);
  });

  test('request rejects the filesystem root with INVALID_WORKING_DIR', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-root', 'machine-gc-root');

    await expect(requestClone(sessionId, machineId, { targetPath: '/' })).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.INVALID_WORKING_DIR },
    });

    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitClone')).toHaveLength(0);
  });

  test('request rejects a machine the caller does not own', async () => {
    const { machineId } = await setupMachine('test-gc-owner', 'machine-gc-owner');
    const { sessionId: otherSessionId } = await createTestSession('test-gc-other-user');

    await expect(requestClone(otherSessionId, machineId)).rejects.toThrow();

    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitClone')).toHaveLength(0);
  });

  test('get returns null for another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-gc-get-owner',
      'machine-gc-get-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-gc-get-other');

    const { requestId } = await requestClone(sessionId, machineId);

    expect(await getRequest(otherSessionId, requestId)).toBeNull();
  });

  test('get returns null for an unknown session', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-get-anon', 'machine-gc-get-anon');
    const { requestId } = await requestClone(sessionId, machineId);

    expect(await getRequest('test-gc-no-such-session' as SessionId, requestId)).toBeNull();
  });

  test('reportProgress moves pending to cloning and clamps and rounds percent', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-progress', 'machine-gc-progress');
    const { requestId } = await requestClone(sessionId, machineId);

    const first = await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'Receiving objects',
      percent: 42.6,
    });
    expect(first).toEqual({ ok: true });

    let row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('cloning');
    expect(row!.progressPhase).toBe('Receiving objects');
    expect(row!.progressPercent).toBe(43);

    await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'Overshoot',
      percent: 250,
    });
    row = await getRequest(sessionId, requestId);
    expect(row!.progressPercent).toBe(100);

    await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'Undershoot',
      percent: -5,
    });
    row = await getRequest(sessionId, requestId);
    expect(row!.progressPercent).toBe(0);
  });

  test('reportProgress truncates the phase to 64 characters', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-phase', 'machine-gc-phase');
    const { requestId } = await requestClone(sessionId, machineId);

    await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'p'.repeat(200),
    });

    const row = await getRequest(sessionId, requestId);
    expect(row!.progressPhase).toHaveLength(64);
  });

  test('reportProgress is ignored after a terminal result', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-late', 'machine-gc-late');
    const { requestId } = await requestClone(sessionId, machineId);

    await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      clonedPath: TARGET_PATH,
    });

    const late = await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'Too late',
      percent: 10,
    });
    expect(late).toEqual({ ok: true, ignored: true });

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('completed');
    expect(row!.progressPhase).toBeUndefined();
  });

  test('reportResult completed requires a clonedPath matching the target', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-match', 'machine-gc-match');
    const { requestId } = await requestClone(sessionId, machineId);

    await expect(
      t.mutation(api.gitCloneRequests.reportResult, {
        sessionId,
        machineId,
        requestId,
        status: 'completed',
        clonedPath: '/Users/test/elsewhere',
      })
    ).rejects.toThrow();

    await expect(
      t.mutation(api.gitCloneRequests.reportResult, {
        sessionId,
        machineId,
        requestId,
        status: 'completed',
      })
    ).rejects.toThrow();

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('pending');
  });

  test('reportResult completed accepts a clonedPath with a trailing slash', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-slash', 'machine-gc-slash');
    const { requestId } = await requestClone(sessionId, machineId);

    const result = await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      clonedPath: `${TARGET_PATH}/`,
    });
    expect(result).toEqual({ ok: true });

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('completed');
    expect(row!.completedAt).toBeDefined();
  });

  test('reportResult failed stores the error code and truncates the message', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-fail', 'machine-gc-fail');
    const { requestId } = await requestClone(sessionId, machineId);

    await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'failed',
      errorCode: 'auth',
      errorMessage: 'e'.repeat(3000),
    });

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('failed');
    expect(row!.errorCode).toBe('auth');
    expect(row!.errorMessage).toHaveLength(2000);
    expect(row!.completedAt).toBeDefined();
  });

  test('reportResult failed defaults the error code to unknown', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-unknown', 'machine-gc-unknown');
    const { requestId } = await requestClone(sessionId, machineId);

    await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'failed',
    });

    const row = await getRequest(sessionId, requestId);
    expect(row!.errorCode).toBe('unknown');
  });

  test('a second reportResult is a duplicate no-op and does not overwrite the first', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-dup', 'machine-gc-dup');
    const { requestId } = await requestClone(sessionId, machineId);

    await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      clonedPath: TARGET_PATH,
    });

    const duplicate = await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'failed',
      errorCode: 'network',
      errorMessage: 'late failure',
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('completed');
    expect(row!.errorCode).toBeUndefined();
  });

  test('reportResult throws when the machineId does not match the request machine', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-mismatch', 'machine-gc-mismatch');
    await registerMachineWithDaemon(sessionId, 'machine-gc-mismatch-other');
    const { requestId } = await requestClone(sessionId, machineId);

    await expect(
      t.mutation(api.gitCloneRequests.reportResult, {
        sessionId,
        machineId: 'machine-gc-mismatch-other',
        requestId,
        status: 'completed',
        clonedPath: TARGET_PATH,
      })
    ).rejects.toThrow('does not belong to this machine');

    const row = await getRequest(sessionId, requestId);
    expect(row!.status).toBe('pending');
  });

  test('end-to-end: request → inbox → progress → result', async () => {
    const { sessionId, machineId } = await setupMachine('test-gc-e2e', 'machine-gc-e2e');

    const { requestId } = await requestClone(sessionId, machineId);

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.gitClone');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.command).toMatchObject({ type: 'daemon.gitClone', requestId });

    await t.mutation(api.gitCloneRequests.reportProgress, {
      sessionId,
      machineId,
      requestId,
      phase: 'Cloning into my-repo',
      percent: 50,
    });
    expect((await getRequest(sessionId, requestId))!.status).toBe('cloning');

    await t.mutation(api.gitCloneRequests.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      clonedPath: TARGET_PATH,
    });
    const done = await getRequest(sessionId, requestId);
    expect(done!.status).toBe('completed');
    expect(done!.targetPath).toBe(TARGET_PATH);
  });
});
