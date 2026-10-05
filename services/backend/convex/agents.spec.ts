import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

const canonicalTeamFacts = [
  {
    teamId: 'duo',
    teamStructureId: 'duo@1',
    roles: ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
    permanentRoles: ['planner', 'builder'],
  },
  {
    teamId: 'solo',
    teamStructureId: 'solo@1',
    roles: ['solo', 'architect', 'triage', 'uiux-engineer'],
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
          ['reviewer', 'persistent'],
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
        statusesWithExtraRows.some(({ role }) => role === 'enhancer' || role === 'reviewer')
      ).toBe(false);
    }
  );
});
