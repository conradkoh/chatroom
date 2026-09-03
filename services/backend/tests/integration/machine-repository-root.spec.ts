/**
 * Machine repository root integration tests.
 *
 * Covers authenticated ownership, normalization, updates, clearing, and path validation
 * through the public Convex API surface.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('machine repository roots', () => {
  test('sets and lists a repository root for an owned machine', async () => {
    const { sessionId } = await createTestSession('test-repository-root-create');
    const machineId = 'machine-repository-root-create';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '/Users/test/repos/',
    });

    const roots = await t.query(api.machines.listMachineRepositoryRoots, { sessionId });
    expect(roots).toEqual({ [machineId]: '/Users/test/repos' });
  });

  test('updates an existing repository root', async () => {
    const { sessionId } = await createTestSession('test-repository-root-update');
    const machineId = 'machine-repository-root-update';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '/tmp/first-root',
    });
    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '/tmp/second-root',
    });

    const roots = await t.query(api.machines.listMachineRepositoryRoots, { sessionId });
    expect(roots).toEqual({ [machineId]: '/tmp/second-root' });
  });

  test('clears a repository root when given undefined or an empty value', async () => {
    const { sessionId } = await createTestSession('test-repository-root-clear');
    const machineId = 'machine-repository-root-clear';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '/tmp/repository-root',
    });
    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '',
    });
    expect(await t.query(api.machines.listMachineRepositoryRoots, { sessionId })).toEqual({});

    await t.mutation(api.machines.setMachineRepositoryRoot, {
      sessionId,
      machineId,
      repositoryRoot: '/tmp/repository-root',
    });
    await t.mutation(api.machines.setMachineRepositoryRoot, { sessionId, machineId });
    expect(await t.query(api.machines.listMachineRepositoryRoots, { sessionId })).toEqual({});
  });

  test('rejects a relative repository root path', async () => {
    const { sessionId } = await createTestSession('test-repository-root-invalid');
    const machineId = 'machine-repository-root-invalid';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.machines.setMachineRepositoryRoot, {
        sessionId,
        machineId,
        repositoryRoot: 'relative/repository',
      })
    ).rejects.toThrow('absolute path');
  });

  test('rejects setting a repository root on another user’s machine', async () => {
    const { sessionId: ownerSessionId } = await createTestSession('test-repository-root-owner');
    const machineId = 'machine-repository-root-owner';
    await registerMachineWithDaemon(ownerSessionId, machineId);
    const { sessionId: otherSessionId } = await createTestSession('test-repository-root-other');

    await expect(
      t.mutation(api.machines.setMachineRepositoryRoot, {
        sessionId: otherSessionId,
        machineId,
        repositoryRoot: '/tmp/should-fail',
      })
    ).rejects.toThrow('different user');

    expect(
      await t.query(api.machines.listMachineRepositoryRoots, { sessionId: ownerSessionId })
    ).toEqual({});
  });
});
