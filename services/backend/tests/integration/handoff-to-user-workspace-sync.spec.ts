/**
 * Handoff-to-user workspace sync — Integration Tests
 *
 * A handoff to `user` no longer enqueues `daemon.gitRefresh` for the chatroom's
 * workspaces. The webapp triggers refresh through `machines.requestGitRefresh`
 * instead, which this spec also pins.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { getGitRefreshCommandsForMachine } from '../helpers/machine-command-inbox';

/** Collect all daemon.gitRefresh inbox commands for a machine + workingDir. */
async function findGitRefreshCommands(machineId: string, workingDir: string) {
  return getGitRefreshCommandsForMachine(machineId, workingDir);
}

async function registerChatroomWorkspace(
  sessionId: string,
  chatroomId: string,
  machineId: string,
  workingDir: string
): Promise<string> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

describe('Handoff-to-user workspace sync', () => {
  test('handoff-to-user enqueues no gitRefresh for any workspace', async () => {
    const { sessionId } = await createTestSession('handoff-sync-user-1');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await registerMachineWithDaemon(sessionId, 'sync-machine-1');

    // Registration itself enqueues one gitRefresh per workspace, so measure handoff effects as deltas.
    await registerChatroomWorkspace(sessionId, chatroomId, 'sync-machine-1', '/sync/ws-1');
    await registerChatroomWorkspace(sessionId, chatroomId, 'sync-machine-1', '/sync/ws-2');
    const ws1Baseline = (await findGitRefreshCommands('sync-machine-1', '/sync/ws-1')).length;
    const ws2Baseline = (await findGitRefreshCommands('sync-machine-1', '/sync/ws-2')).length;
    // A freshly registered workspace already has a pending gitRefresh, with no handoff yet
    expect(ws1Baseline).toBe(1);
    expect(ws2Baseline).toBe(1);

    // Handoff to builder must NOT enqueue any gitRefresh events
    const builderHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Handing work to builder.',
    });
    expect(builderHandoff.success).toBe(true);

    // Handoff to user must NOT enqueue any gitRefresh events either
    const userHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Done — handing back to user.',
    });
    expect(userHandoff.success).toBe(true);

    expect(await findGitRefreshCommands('sync-machine-1', '/sync/ws-1')).toHaveLength(ws1Baseline);
    expect(await findGitRefreshCommands('sync-machine-1', '/sync/ws-2')).toHaveLength(ws2Baseline);
  });

  test('soft-deleted workspaces are still excluded from registration refreshes', async () => {
    const { sessionId } = await createTestSession('handoff-sync-user-2');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await registerMachineWithDaemon(sessionId, 'sync-machine-2');

    const activeWs = await registerChatroomWorkspace(
      sessionId,
      chatroomId,
      'sync-machine-2',
      '/sync/ws-active'
    );
    const removedWs = await registerChatroomWorkspace(
      sessionId,
      chatroomId,
      'sync-machine-2',
      '/sync/ws-removed'
    );

    // Soft-delete the second workspace
    await t.mutation(api.workspaces.removeWorkspace, {
      sessionId,
      workspaceId: removedWs,
    });

    // Registration enqueues one gitRefresh per workspace, so measure the handoff as a delta.
    const activeBaseline = (await findGitRefreshCommands('sync-machine-2', '/sync/ws-active'))
      .length;
    const removedBaseline = (await findGitRefreshCommands('sync-machine-2', '/sync/ws-removed'))
      .length;

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Handing back to user after cleanup.',
    });

    const activeRows = await findGitRefreshCommands('sync-machine-2', '/sync/ws-active');
    const removedRows = await findGitRefreshCommands('sync-machine-2', '/sync/ws-removed');
    expect(activeRows).toHaveLength(activeBaseline);
    expect(removedRows).toHaveLength(removedBaseline);
    expect(activeWs).not.toBe(removedWs);
  });

  test('machines.requestGitRefresh still enqueues one daemon.gitRefresh for the machine', async () => {
    const { sessionId } = await createTestSession('handoff-sync-manual');
    await registerMachineWithDaemon(sessionId, 'sync-machine-manual');

    const before = (await findGitRefreshCommands('sync-machine-manual', '/sync/manual')).length;

    await t.mutation(api.machines.requestGitRefresh, {
      sessionId,
      machineId: 'sync-machine-manual',
      workingDir: '/sync/manual',
    });

    const rows = await findGitRefreshCommands('sync-machine-manual', '/sync/manual');
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]!.machineId).toBe('sync-machine-manual');
  });
});
