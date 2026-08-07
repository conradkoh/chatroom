/**
 * Handoff-to-user workspace sync — Integration Tests
 *
 * Verifies that a handoff to `user` enqueues a `daemon.gitRefresh` event for
 * every active workspace in the chatroom, while a handoff to a team role
 * (e.g. builder) does not, and soft-deleted workspaces are excluded.
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

interface GitRefreshEvent {
  type: 'daemon.gitRefresh';
  machineId: string;
  workingDir: string;
  timestamp: number;
}

/** Collect all daemon.gitRefresh events for a given workingDir, if any. */
async function findGitRefreshEvents(workingDir: string): Promise<GitRefreshEvent[]> {
  return t.run(async (ctx) => {
    const events = await ctx.db.query('chatroom_eventStream').collect();
    return events.filter(
      (e): e is GitRefreshEvent => e.type === 'daemon.gitRefresh' && e.workingDir === workingDir
    );
  });
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
  test('handoff-to-user enqueues gitRefresh per active workspace; handoff-to-builder does not', async () => {
    const { sessionId } = await createTestSession('handoff-sync-user-1');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await registerMachineWithDaemon(sessionId, 'sync-machine-1');

    await registerChatroomWorkspace(sessionId, chatroomId, 'sync-machine-1', '/sync/ws-1');
    await registerChatroomWorkspace(sessionId, chatroomId, 'sync-machine-1', '/sync/ws-2');

    // Handoff to builder must NOT enqueue any gitRefresh events
    const builderHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Handing work to builder.',
    });
    expect(builderHandoff.success).toBe(true);
    expect(await findGitRefreshEvents('/sync/ws-1')).toHaveLength(0);
    expect(await findGitRefreshEvents('/sync/ws-2')).toHaveLength(0);

    // Handoff to user must enqueue gitRefresh for every active workspace
    const userHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Done — handing back to user.',
    });
    expect(userHandoff.success).toBe(true);

    const ws1Events = await findGitRefreshEvents('/sync/ws-1');
    const ws2Events = await findGitRefreshEvents('/sync/ws-2');
    expect(ws1Events).toHaveLength(1);
    expect(ws2Events).toHaveLength(1);
    expect(ws1Events[0].machineId).toBe('sync-machine-1');
    expect(ws2Events[0].machineId).toBe('sync-machine-1');
  });

  test('soft-deleted workspaces are excluded from gitRefresh enqueue', async () => {
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

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Handing back to user after cleanup.',
    });

    const activeEvents = await findGitRefreshEvents('/sync/ws-active');
    const removedEvents = await findGitRefreshEvents('/sync/ws-removed');
    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0].machineId).toBe('sync-machine-2');
    expect(removedEvents).toHaveLength(0);
    expect(activeWs).not.toBe(removedWs);
  });
});
