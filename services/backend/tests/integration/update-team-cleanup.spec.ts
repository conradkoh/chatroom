/**
 * Update Team — Integration Tests
 *
 * Verifies the team switch lifecycle:
 * 1. Team agent configs are deleted (platform-owned, recreated on restart)
 * 2. Stop events are dispatched for running agents
 * 3. Agent preferences are NOT deleted (UI hints, preserved for future use)
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

function createSquadChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, {
    sessionId: sessionId as any,
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
  });
}

async function savePref(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  machineId: string
) {
  await t.mutation(api.machines.saveAgentPreference, {
    sessionId: sessionId as any,
    chatroomId,
    role,
    machineId,
    agentHarness: 'opencode',
    model: 'claude-sonnet-4',
    workingDir: '/test/workspace',
  });
}

// ─── teamAgentConfigs lifecycle ───────────────────────────────────────────────

describe('updateTeam — teamAgentConfigs', () => {
  test('deletes all teamAgentConfigs on team switch', async () => {
    const { sessionId } = await createTestSession('test-ut-tac-1');
    const machineId = 'machine-ut-tac-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const teamConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(teamConfigs).toHaveLength(0);
  });
});

// ─── agentPreferences preserved ───────────────────────────────────────────────

describe('updateTeam — agentPreferences preserved', () => {
  test('does NOT delete agentPreferences (UI hints, preserved for future use)', async () => {
    const { sessionId } = await createTestSession('test-ut-pref-1');
    const machineId = 'machine-ut-pref-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await savePref(sessionId, chatroomId, 'planner', machineId);
    await savePref(sessionId, chatroomId, 'builder', machineId);
    await savePref(sessionId, chatroomId, 'reviewer', machineId);

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const afterPrefs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_agentPreferences')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(afterPrefs).toHaveLength(3);
  });
});

// ─── Stop events dispatched ──────────────────────────────────────────────────

describe('updateTeam — stop events', () => {
  test('dispatches stop events for running agents from teamAgentConfigs', async () => {
    const { sessionId } = await createTestSession('test-ut-stop-1');
    const machineId = 'machine-ut-stop-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    // Check stop events were dispatched
    const stopEvents = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStop')
        )
        .collect();
    });

    const teamSwitchStops = stopEvents.filter((e) =>
      'reason' in e && e.reason === 'platform.team_switch'
    );
    // Both planner and builder had desiredState=running from setupRemoteAgentConfig
    expect(teamSwitchStops.length).toBeGreaterThanOrEqual(2);
  });

});

// ─── Chatroom team fields updated ─────────────────────────────────────────────

describe('updateTeam — chatroom fields', () => {
  test('updates teamId, teamName, teamRoles, teamEntryPoint', async () => {
    const { sessionId } = await createTestSession('test-ut-fields-1');
    const chatroomId = await createSquadChatroom(sessionId);

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const room = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_rooms', chatroomId);
    });

    expect(room!.teamId).toBe('duo');
    expect(room!.teamName).toBe('Duo Team');
    expect(room!.teamRoles).toEqual(['planner', 'builder']);
    expect(room!.teamEntryPoint).toBe('planner');
  });
});
