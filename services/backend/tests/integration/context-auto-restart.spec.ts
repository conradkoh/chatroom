/**
 * Integration tests: auto-restart agents when new context is created.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function enableAutoRestartOnNewContext(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  await t.mutation(api.machines.setAutoRestartOnNewContext, {
    sessionId,
    chatroomId,
    role,
    enabled: true,
  });
}

async function findNewContextRestartEvents(chatroomId: Id<'chatroom_rooms'>) {
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  return events.filter(
    (e) =>
      e.type === 'agent.requestStart' &&
      (e as { reason?: string }).reason === 'platform.auto_restart_on_new_context'
  );
}

test('createContext emits agent.requestStart for builder with autoRestartOnNewContext enabled', async () => {
  const { sessionId } = await createTestSession('ctx-restart-a');
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
  const machineId = 'machine-ctx-restart-a';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
  await enableAutoRestartOnNewContext(sessionId, chatroomId, 'builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { desiredState: 'running' });
    }
  });

  await t.mutation(api.contexts.createContext, {
    sessionId,
    chatroomId,
    content: 'New pinned context',
    role: 'builder',
  });

  const restartEvents = await findNewContextRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('builder');
  expect(restartEvents[0].machineId).toBe(machineId);
  if (restartEvents[0].type === 'agent.requestStart') {
    expect(restartEvents[0].autoRestartOnNewContext).toBe(true);
    // A new pinned context is a deliberate fresh start — never resume the prior
    // harness session, regardless of the persisted wantResume preference.
    expect(restartEvents[0].wantResume).toBe(false);
  }
});

test('createContext does not restart builder when autoRestartOnNewContext is disabled', async () => {
  const { sessionId } = await createTestSession('ctx-restart-b');
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
  const machineId = 'machine-ctx-restart-b';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.contexts.createContext, {
    sessionId,
    chatroomId,
    content: 'Context without restart',
    role: 'builder',
  });

  const restartEvents = await findNewContextRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(0);
});

test('setAutoRestartOnNewContext rejects non-builder roles', async () => {
  const { sessionId } = await createTestSession('ctx-restart-c');
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

  await expect(
    t.mutation(api.machines.setAutoRestartOnNewContext, {
      sessionId,
      chatroomId,
      role: 'planner',
      enabled: true,
    })
  ).rejects.toThrow(/INVALID_ROLE/);
});
