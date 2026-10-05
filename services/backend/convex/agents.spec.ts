import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

describe('canonical agent reads', () => {
  test.each([
    [
      'duo',
      'duo@1',
      ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
      ['planner', 'builder'],
    ],
    ['solo', 'solo@1', ['solo', 'architect', 'triage', 'uiux-engineer'], ['solo']],
  ] as const)(
    'lists canonical %s roles before any launch request exists',
    async (team, teamStructureId, roles, permanentRoles) => {
      const sessionId = `canonical-agent-roles-${team}`;
      const login = await t.mutation(api.auth.loginAnon, { sessionId: sessionId as any });
      expect(login.success).toBe(true);
      const chatroomId = await t.mutation(api.chatrooms.create, {
        sessionId: sessionId as any,
        teamStructureId,
      });

      const requests = await t.query(api.agents.listLastSentLaunchRequests, {
        sessionId: sessionId as any,
        chatroomId,
      });
      const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
        sessionId: sessionId as any,
        chatroomId,
      });
      const statuses = await t.query(api.agents.listStatus, {
        sessionId: sessionId as any,
        chatroomId,
      });

      expect(requests).toEqual([]);
      expect(structure.roles.map(({ role }) => role)).toEqual(roles);
      expect(structure.roles.find(({ role }) => role === 'triage')).toMatchObject({
        lifecycle: 'ephemeral',
        optional: true,
      });
      expect(statuses.map((status) => status.role)).toEqual(roles);
      expect(statuses.find((status) => status.role === 'triage')).toMatchObject({
        status: 'offline',
        optional: true,
        roleKind: 'ephemeral',
      });
      expect(statuses.filter((status) => !status.optional).map((status) => status.role)).toEqual(
        permanentRoles
      );
      expect(statuses.every((status) => status.status === 'offline')).toBe(true);
    }
  );
});
