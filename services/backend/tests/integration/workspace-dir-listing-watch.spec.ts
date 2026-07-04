/**
 * Workspace Directory Listing Watch Registry — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace dir listing watch registry', () => {
  test('observe increments observerCount and seeds root path', async () => {
    const { sessionId } = await createTestSession('test-wdlw-observe');
    const machineId = 'machine-wdlw-observe';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: true,
    });
    expect(result).toEqual({ observerCount: 1 });

    const targets = await t.query(api.workspaceFiles.listDirListingWatchTargets, {
      sessionId,
      machineId,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.workingDir).toBe(workingDir);
    expect(targets[0]?.activeDirPaths).toEqual(['']);
  });

  test('setDirListingWatchPaths updates active dirs and ensures root', async () => {
    const { sessionId } = await createTestSession('test-wdlw-paths');
    const machineId = 'machine-wdlw-paths';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: true,
    });

    const result = await t.mutation(api.workspaceFiles.setDirListingWatchPaths, {
      sessionId,
      machineId,
      workingDir,
      activeDirPaths: ['src', 'src/foo'],
    });

    expect(result.observerCount).toBe(1);
    expect(result.activeDirPaths).toEqual(['', 'src', 'src/foo']);

    const targets = await t.query(api.workspaceFiles.listDirListingWatchTargets, {
      sessionId,
      machineId,
    });
    expect(targets[0]?.activeDirPaths).toEqual(['', 'src', 'src/foo']);
  });

  test('unobserve decrements to zero and clears from daemon targets', async () => {
    const { sessionId } = await createTestSession('test-wdlw-unobserve');
    const machineId = 'machine-wdlw-unobserve';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: true,
    });
    await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: true,
    });

    const firstUnobserve = await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: false,
    });
    expect(firstUnobserve).toEqual({ observerCount: 1 });

    let targets = await t.query(api.workspaceFiles.listDirListingWatchTargets, {
      sessionId,
      machineId,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.observerCount).toBe(1);

    const secondUnobserve = await t.mutation(api.workspaceFiles.setDirListingExplorerObserver, {
      sessionId,
      machineId,
      workingDir,
      observing: false,
    });
    expect(secondUnobserve).toEqual({ observerCount: 0 });

    targets = await t.query(api.workspaceFiles.listDirListingWatchTargets, {
      sessionId,
      machineId,
    });
    expect(targets).toHaveLength(0);
  });

  test('setDirListingWatchPaths no-ops when observerCount is 0', async () => {
    const { sessionId } = await createTestSession('test-wdlw-noop');
    const machineId = 'machine-wdlw-noop';
    const workingDir = '/tmp/workspace';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.mutation(api.workspaceFiles.setDirListingWatchPaths, {
      sessionId,
      machineId,
      workingDir,
      activeDirPaths: ['src'],
    });

    expect(result).toEqual({ observerCount: 0, activeDirPaths: [] });

    const targets = await t.query(api.workspaceFiles.listDirListingWatchTargets, {
      sessionId,
      machineId,
    });
    expect(targets).toHaveLength(0);
  });
});
