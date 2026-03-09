/**
 * Update Team Cleanup — Integration Tests
 *
 * Verifies that switching teams purges stale records from all three
 * agent config tables: teamAgentConfigs, machineAgentConfigs, and
 * agentPreferences. Only records for roles not in the new team are deleted.
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

// ─── machineAgentConfigs cleanup ──────────────────────────────────────────────

describe('updateTeam — machineAgentConfigs cleanup', () => {
  test('deletes machineAgentConfigs for roles removed from team', async () => {
    const { sessionId } = await createTestSession('test-utc-mac-1');
    const machineId = 'machine-utc-mac-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    // Start agents for all 3 squad roles → creates machineAgentConfigs
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');

    // Verify all 3 machineAgentConfigs exist
    const beforeConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(beforeConfigs).toHaveLength(3);

    // Switch from squad to duo (removes "reviewer")
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    // Verify: reviewer machineAgentConfig deleted, planner+builder preserved
    const afterConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(afterConfigs).toHaveLength(2);
    const afterRoles = afterConfigs.map((c) => c.role).sort();
    expect(afterRoles).toEqual(['builder', 'planner']);
  });

  test('preserves machineAgentConfigs when team roles stay the same', async () => {
    const { sessionId } = await createTestSession('test-utc-mac-2');
    const machineId = 'machine-utc-mac-2';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    // Switch team but keep same roles
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'squad-v2',
      teamName: 'Squad V2',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamEntryPoint: 'planner',
    });

    const afterConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // planner + builder should be preserved (reviewer was never created)
    expect(afterConfigs).toHaveLength(2);
  });
});

// ─── agentPreferences cleanup ─────────────────────────────────────────────────

describe('updateTeam — agentPreferences cleanup', () => {
  test('deletes agentPreferences for roles removed from team', async () => {
    const { sessionId } = await createTestSession('test-utc-pref-1');
    const machineId = 'machine-utc-pref-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    // Save preferences for all 3 roles
    await savePref(sessionId, chatroomId, 'planner', machineId);
    await savePref(sessionId, chatroomId, 'builder', machineId);
    await savePref(sessionId, chatroomId, 'reviewer', machineId);

    const beforePrefs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_agentPreferences')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(beforePrefs).toHaveLength(3);

    // Switch to duo — removes "reviewer"
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
    expect(afterPrefs).toHaveLength(2);
    const afterRoles = afterPrefs.map((p) => p.role).sort();
    expect(afterRoles).toEqual(['builder', 'planner']);
  });

  test('preserves agentPreferences for roles that remain in team', async () => {
    const { sessionId } = await createTestSession('test-utc-pref-2');
    const machineId = 'machine-utc-pref-2';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await savePref(sessionId, chatroomId, 'planner', machineId);
    await savePref(sessionId, chatroomId, 'builder', machineId);

    // Switch to duo — planner + builder persist
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
    expect(afterPrefs).toHaveLength(2);
  });
});

// ─── Combined cleanup ─────────────────────────────────────────────────────────

describe('updateTeam — combined cleanup on team switch', () => {
  test('purges all stale data when switching from squad to duo', async () => {
    const { sessionId } = await createTestSession('test-utc-combo-1');
    const machineId = 'machine-utc-combo-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    // Set up configs and prefs for all 3 roles
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');
    await savePref(sessionId, chatroomId, 'planner', machineId);
    await savePref(sessionId, chatroomId, 'builder', machineId);
    await savePref(sessionId, chatroomId, 'reviewer', machineId);

    // Switch to duo
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    // teamAgentConfigs — all deleted (fresh start under new team)
    const teamConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(teamConfigs).toHaveLength(0);

    // machineAgentConfigs — reviewer deleted, planner+builder preserved
    const machineConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(machineConfigs).toHaveLength(2);
    expect(machineConfigs.map((c) => c.role).sort()).toEqual(['builder', 'planner']);

    // agentPreferences — reviewer deleted, planner+builder preserved
    const prefs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_agentPreferences')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(prefs).toHaveLength(2);
    expect(prefs.map((p) => p.role).sort()).toEqual(['builder', 'planner']);
  });
});
