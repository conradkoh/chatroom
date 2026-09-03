/**
 * Repository clone request integration tests.
 * Covers request creation, ownership, lifecycle reporting, and validation.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

async function setupMachine(sessionKey: string, machineId: string, repositoryRoot = '/tmp/repos') {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  await t.mutation(api.machines.setMachineRepositoryRoot, {
    sessionId,
    machineId,
    repositoryRoot,
  });
  return { sessionId, machineId };
}

describe('repository clone requests', () => {
  test('request creates a pending request and daemon.cloneRepository inbox command', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-create',
      'machine-repo-clone-create'
    );

    const { requestId } = await t.mutation(api.machines.requestRepositoryClone, {
      sessionId,
      machineId,
      githubUrl: 'https://github.com/acme/widget',
    });

    const request = await t.query(api.machines.getRepositoryCloneRequest, {
      sessionId,
      requestId,
    });
    expect(request).toMatchObject({
      status: 'pending',
      machineId,
      githubUrl: 'https://github.com/acme/widget',
      cloneUrl: 'https://github.com/acme/widget.git',
      repoName: 'widget',
      targetWorkingDir: '/tmp/repos/widget',
    });

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.cloneRepository');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.command).toMatchObject({
      type: 'daemon.cloneRepository',
      requestId,
      cloneUrl: 'https://github.com/acme/widget.git',
      targetWorkingDir: '/tmp/repos/widget',
    });
  });

  test('getRepositoryCloneRequest returns null for another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-owner',
      'machine-repo-clone-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-repo-clone-other');
    const { requestId } = await t.mutation(api.machines.requestRepositoryClone, {
      sessionId,
      machineId,
      githubUrl: 'https://github.com/acme/owner-only',
    });

    const request = await t.query(api.machines.getRepositoryCloneRequest, {
      sessionId: otherSessionId,
      requestId,
    });
    expect(request).toBeNull();
  });

  test('report completes a request with working directory and cloned flag', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-complete',
      'machine-repo-clone-complete'
    );
    const { requestId } = await t.mutation(api.machines.requestRepositoryClone, {
      sessionId,
      machineId,
      githubUrl: 'https://github.com/acme/completed',
    });

    const result = await t.mutation(api.machines.reportRepositoryCloneResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      workingDir: '/tmp/repos/completed',
      cloned: true,
    });
    expect(result).toEqual({ ok: true });

    const request = await t.query(api.machines.getRepositoryCloneRequest, {
      sessionId,
      requestId,
    });
    expect(request).toMatchObject({
      status: 'completed',
      workingDir: '/tmp/repos/completed',
      cloned: true,
    });
    expect(request!.completedAt).toBeDefined();
  });

  test('report is idempotent after completion', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-duplicate',
      'machine-repo-clone-duplicate'
    );
    const { requestId } = await t.mutation(api.machines.requestRepositoryClone, {
      sessionId,
      machineId,
      githubUrl: 'https://github.com/acme/duplicate',
    });

    await t.mutation(api.machines.reportRepositoryCloneResult, {
      sessionId,
      machineId,
      requestId,
      status: 'completed',
      workingDir: '/tmp/repos/duplicate',
      cloned: false,
    });
    const duplicate = await t.mutation(api.machines.reportRepositoryCloneResult, {
      sessionId,
      machineId,
      requestId,
      status: 'failed',
      errorMessage: 'late failure',
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });

    const request = await t.query(api.machines.getRepositoryCloneRequest, {
      sessionId,
      requestId,
    });
    expect(request).toMatchObject({ status: 'completed', cloned: false });
  });

  test('rejects an invalid GitHub URL', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-invalid-url',
      'machine-repo-clone-invalid-url'
    );

    await expect(
      t.mutation(api.machines.requestRepositoryClone, {
        sessionId,
        machineId,
        githubUrl: 'https://gitlab.com/acme/widget',
      })
    ).rejects.toThrow('Invalid GitHub repository URL');
  });

  test('rejects a machine without a configured repository root', async () => {
    const { sessionId } = await createTestSession('test-repo-clone-no-root');
    const machineId = 'machine-repo-clone-no-root';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.machines.requestRepositoryClone, {
        sessionId,
        machineId,
        githubUrl: 'https://github.com/acme/no-root',
      })
    ).rejects.toThrow('Set a repository root');
  });

  test('rejects a cross-user report', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-repo-clone-report-owner',
      'machine-repo-clone-report-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-repo-clone-report-other');
    const { requestId } = await t.mutation(api.machines.requestRepositoryClone, {
      sessionId,
      machineId,
      githubUrl: 'https://github.com/acme/cross-user',
    });

    await expect(
      t.mutation(api.machines.reportRepositoryCloneResult, {
        sessionId: otherSessionId,
        machineId,
        requestId,
        status: 'completed',
        workingDir: '/tmp/repos/cross-user',
        cloned: true,
      })
    ).rejects.toThrow('different user');
  });
});
