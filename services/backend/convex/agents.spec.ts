import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import { TEST_MODEL_OPENCODE } from '../tests/helpers/test-models';

const canonicalTeamFacts = [
  {
    teamId: 'duo',
    teamStructureId: 'duo@1',
    roles: [
      'planner',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
      'builder',
    ],
    permanentRoles: ['planner', 'builder'],
  },
  {
    teamId: 'solo',
    teamStructureId: 'solo@1',
    roles: ['solo', 'architect', 'triage', 'uiux-engineer', 'verifier'],
    permanentRoles: ['solo'],
  },
] as const;

describe('canonical agent reads', () => {
  test.each(canonicalTeamFacts)(
    'lists every canonical $teamId role before launch or runtime state exists',
    async ({ teamId, teamStructureId, roles, permanentRoles }) => {
      const sessionId = `canonical-agent-roles-${teamId}` as SessionId;
      const login = await t.mutation(api.auth.loginAnon, { sessionId });
      expect(login.success).toBe(true);
      const chatroomId = await t.mutation(api.chatrooms.create, {
        sessionId,
        teamStructureId,
      });

      const [requests, structure, statuses, overview] = await Promise.all([
        t.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId }),
        t.query(api.chatrooms.getTeamStructureForChatroom, { sessionId, chatroomId }),
        t.query(api.agents.listStatus, { sessionId, chatroomId }),
        t.query(api.agents.getViewStatus, { sessionId, chatroomId }),
      ]);
      const sharedStructure = getTeamStructure({ teamId });

      expect(requests).toEqual([]);
      expect(structure.teamStructureId).toBe(teamStructureId);
      expect(structure.roles.map(({ role }) => role)).toEqual(roles);
      expect(structure.roles).toEqual(sharedStructure.roles);
      expect(
        structure.roles.filter(({ lifecycle }) => lifecycle === 'permanent').map(({ role }) => role)
      ).toEqual(permanentRoles);
      expect(structure.roles.filter(({ lifecycle }) => lifecycle === 'ephemeral')).toHaveLength(
        roles.length - permanentRoles.length
      );
      expect(statuses.map(({ role }) => role)).toEqual(roles);
      expect(
        statuses.filter(({ roleKind }) => roleKind === 'persistent').map(({ role }) => role)
      ).toEqual(permanentRoles);
      expect(
        statuses.filter(({ roleKind }) => roleKind === 'ephemeral').map(({ role }) => role)
      ).toEqual(
        sharedStructure.roles
          .filter(({ lifecycle }) => lifecycle === 'ephemeral')
          .map(({ role }) => role)
      );
      expect(overview?.teamRoles).toEqual(roles);
      expect(overview?.agents.map(({ role }) => role)).toEqual(roles);
      expect(overview?.agents.every(({ state }) => state === 'stopped')).toBe(true);

      for (const role of sharedStructure.roles) {
        const status = statuses.find((entry) => entry.role === role.role);
        const overviewAgent = overview?.agents.find((entry) => entry.role === role.role);
        expect(status).toMatchObject({
          role: role.role,
          roleKind: role.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
          optional: role.optional,
          status: 'offline',
          isRunning: false,
          machineId: null,
          workingDir: null,
          lastSeenAt: null,
          lastSeenAction: null,
          activeWork: null,
          error: null,
          projectedAt: null,
        });
        expect(overviewAgent).toMatchObject({
          role: role.role,
          state: 'stopped',
          type: 'remote',
          lastSeenAt: null,
          lastSeenAction: null,
        });
        expect(overviewAgent?.machineId).toBeUndefined();
        expect(overviewAgent?.machineName).toBeUndefined();
      }

      await t.run(async (ctx) => {
        await ctx.db.patch('chatroom_rooms', chatroomId, {
          teamId,
          teamRoles: [...permanentRoles],
          teamEntryPoint: permanentRoles[0],
        });
        for (const [role, roleKind] of [
          ['designer', 'persistent'],
          ['enhancer', 'ephemeral'],
        ] as const) {
          await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
            chatroomId,
            role,
            roleKind,
            status: 'offline',
            projectedAt: Date.now(),
          });
        }
      });

      const [structureWithStaleRows, statusesWithExtraRows, overviewWithExtraRows, requestsAfter] =
        await Promise.all([
          t.query(api.chatrooms.getTeamStructureForChatroom, { sessionId, chatroomId }),
          t.query(api.agents.listStatus, { sessionId, chatroomId }),
          t.query(api.agents.getViewStatus, { sessionId, chatroomId }),
          t.query(api.agents.listLastSentLaunchRequests, { sessionId, chatroomId }),
        ]);
      expect(structureWithStaleRows.roles.map(({ role }) => role)).toEqual(roles);
      expect(statusesWithExtraRows.map(({ role }) => role)).toEqual(roles);
      expect(overviewWithExtraRows?.teamRoles).toEqual(roles);
      expect(overviewWithExtraRows?.agents.map(({ role }) => role)).toEqual(roles);
      expect(requestsAfter).toEqual([]);
      expect(
        statusesWithExtraRows.some(({ role }) => role === 'enhancer' || role === 'designer')
      ).toBe(false);
    }
  );
});

/**
 * The message-triggered wake path is one of the start paths that passes the
 * room row as `legacyRoom`, so a non-preset structure id keeps the roles
 * persisted on the room instead of resolving to an empty roster.
 */
describe('startNonRunningAgentsForChatroom', () => {
  test('wakes a non-running builder for a legacy team structure id from persisted roles', async () => {
    const sessionId = 'legacy-wake-agent-roles' as SessionId;
    const machineId = 'legacy-wake-agent-roles-machine';
    const workingDir = '/test/legacy-wake';
    const login = await t.mutation(api.auth.loginAnon, { sessionId });
    expect(login.success).toBe(true);
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });
    const { chatroomId, workspaceId } = await t.mutation(api.chatrooms.createWithWorkspace, {
      sessionId,
      teamStructureId: 'duo',
      machineId,
      workingDir,
    });

    await t.run(async (ctx) => {
      const active = await ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
      await ctx.db.patch('chatroom_activeTeamStructures', active!._id, {
        teamStructureId: 'legacy-squad',
      });
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        teamRoles: ['planner', 'builder'],
      });
    });

    // Save the launch configuration after the legacy patch so the machine
    // binding is recorded against the structure id the wake path resolves.
    await t.mutation(api.agents.requestStart, {
      sessionId,
      machineId,
      chatroomId,
      workspaceId,
      role: 'builder',
      agentHarness: 'opencode',
      model: TEST_MODEL_OPENCODE,
      workingDir,
    });

    const result = await t.mutation(internal.agents.startNonRunningAgentsForChatroom, {
      chatroomId,
    });

    expect(result.started).toContain('builder');
    expect(result.skipped.map(({ role }) => role)).not.toContain('builder');
    expect(result.failed).toEqual([]);
  });
});
