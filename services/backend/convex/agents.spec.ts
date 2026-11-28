import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { syncActiveTaskHeader } from '../src/domain/usecase/task/active-task-header';

const canonicalTeamFacts = [
  {
    teamId: 'duo',
    teamStructureId: 'duo@1',
    roles: [
      'planner',
      'product-manager',
      'architect',
      'prompt-engineer',
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
    roles: [
      'solo',
      'product-manager',
      'architect',
      'prompt-engineer',
      'triage',
      'uiux-engineer',
      'verifier',
    ],
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
          hasAssignedTask: false,
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

type TaskStatus = Doc<'chatroom_tasks'>['status'];

/** Creates a duo chatroom in a fresh anonymous session. */
async function createDuoChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  return t.mutation(api.chatrooms.create, { sessionId, teamStructureId: 'duo@1' });
}

/** Inserts a task and syncs its header through the production writer. */
async function createTask(
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string,
  status: TaskStatus
): Promise<Id<'chatroom_tasks'>> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Assigned work',
      queuePosition: 0,
      status,
      assignedTo,
      createdAt: now,
      updatedAt: now,
    });
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error('Task missing after insert');
    await syncActiveTaskHeader(ctx, task);
    return taskId;
  });
}

/** Patches a task and re-runs the header writer, as the production task writers do. */
async function updateTask(
  taskId: Id<'chatroom_tasks'>,
  patch: { status?: TaskStatus; assignedTo?: string | undefined }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_tasks', taskId, { ...patch, updatedAt: Date.now() });
    const task = await ctx.db.get('chatroom_tasks', taskId);
    if (!task) throw new Error('Task missing after patch');
    await syncActiveTaskHeader(ctx, task);
  });
}

/** Roles flagged with an assigned active task, in team order. */
async function assignedRolesOf(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>
): Promise<string[]> {
  const statuses = await t.query(api.agents.listStatus, { sessionId, chatroomId });
  return statuses.filter(({ hasAssignedTask }) => hasAssignedTask).map(({ role }) => role);
}

describe('agents.listStatus hasAssignedTask', () => {
  test('is false for every role when no task exists', async () => {
    const sessionId = 'has-assigned-task-empty' as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    const statuses = await t.query(api.agents.listStatus, { sessionId, chatroomId });
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every(({ hasAssignedTask }) => hasAssignedTask === false)).toBe(true);
  });

  test.each(['pending', 'acknowledged', 'in_progress'] as const)(
    'flags the assigned ephemeral role for a %s task, with no read-model row',
    async (status) => {
      const sessionId = `has-assigned-task-${status}` as SessionId;
      const chatroomId = await createDuoChatroom(sessionId);
      await createTask(chatroomId, 'architect', status);
      expect(await assignedRolesOf(sessionId, chatroomId)).toEqual(['architect']);
    }
  );

  test.each([
    ['completed', { status: 'completed' as const }],
    ['closed', { status: 'closed' as const }],
    ['unassigned', { assignedTo: undefined }],
  ])('clears the flag when the task is %s', async (_label, patch) => {
    const sessionId = `has-assigned-task-clear-${_label}` as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    const taskId = await createTask(chatroomId, 'architect', 'in_progress');
    expect(await assignedRolesOf(sessionId, chatroomId)).toEqual(['architect']);
    await updateTask(taskId, patch);
    expect(await assignedRolesOf(sessionId, chatroomId)).toEqual([]);
  });

  test('matches the assigned role case-insensitively', async () => {
    const sessionId = 'has-assigned-task-case' as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    await createTask(chatroomId, 'Architect', 'pending');
    expect(await assignedRolesOf(sessionId, chatroomId)).toEqual(['architect']);
  });

  test('flags a permanent role and leaves ephemeral roles unflagged', async () => {
    const sessionId = 'has-assigned-task-permanent' as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    await createTask(chatroomId, 'builder', 'in_progress');
    expect(await assignedRolesOf(sessionId, chatroomId)).toEqual(['builder']);
  });

  test('keeps the flag true for an errored role and leaves activeWork null', async () => {
    const sessionId = 'has-assigned-task-error' as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'architect',
        roleKind: 'ephemeral',
        status: 'error',
        projectedAt: Date.now(),
      });
    });
    await createTask(chatroomId, 'architect', 'pending');
    const statuses = await t.query(api.agents.listStatus, { sessionId, chatroomId });
    expect(statuses.find(({ role }) => role === 'architect')).toMatchObject({
      status: 'error',
      hasAssignedTask: true,
      activeWork: null,
    });
  });

  test('does not leak an assignment from another chatroom', async () => {
    const sessionId = 'has-assigned-task-isolation' as SessionId;
    const chatroomId = await createDuoChatroom(sessionId);
    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo@1',
    });
    await createTask(otherChatroomId, 'architect', 'pending');
    expect(await assignedRolesOf(sessionId, chatroomId)).toEqual([]);
    expect(await assignedRolesOf(sessionId, otherChatroomId)).toEqual(['architect']);
  });
});
