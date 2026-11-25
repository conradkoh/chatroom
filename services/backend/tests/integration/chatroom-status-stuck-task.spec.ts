/**
 * Regression evidence: a chatroom with an active task assigned to an offline or errored agent
 * surfaces the 'stuck' aggregate status, which renders bg-chatroom-status-error.
 */
import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession } from '../helpers/integration';

const STUCK = 'stuck';

async function seed(
  chatroomId: any,
  rows: { role: string; status: any }[],
  task?: { assignedTo: string; status: 'pending' | 'acknowledged' | 'in_progress' }
) {
  await t.run(async (ctx) => {
    for (const r of rows) {
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: r.role,
        roleKind: isEphemeralAgentRole(r.role) ? 'ephemeral' : 'persistent',
        status: r.status,
        projectedAt: Date.now(),
      });
    }
    if (task) {
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'x',
        queuePosition: 0,
        status: task.status,
        assignedTo: task.assignedTo,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any);
      await ctx.db.insert('chatroom_activeTaskHeaders', {
        taskId,
        chatroomId,
        status: task.status,
        assignedTo: task.assignedTo,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
}

describe('agents.getChatroomStatus — stuck task on offline/error agent', () => {
  test.each([
    [
      'all offline + in_progress task on builder',
      [
        { role: 'builder', status: 'offline' },
        { role: 'planner', status: 'offline' },
      ],
      { assignedTo: 'builder', status: 'in_progress' },
    ],
    [
      'error assignee + pending task',
      [{ role: 'builder', status: 'error' }],
      { assignedTo: 'builder', status: 'pending' },
    ],
    [
      'offline assignee masked by working planner (would be blue)',
      [
        { role: 'builder', status: 'offline' },
        { role: 'planner', status: 'working' },
      ],
      { assignedTo: 'builder', status: 'in_progress' },
    ],
    [
      'offline assignee masked by waiting planner (would be green)',
      [
        { role: 'builder', status: 'offline' },
        { role: 'planner', status: 'waiting' },
      ],
      { assignedTo: 'builder', status: 'acknowledged' },
    ],
    [
      'no role-status row for assignee (treated as offline)',
      [{ role: 'planner', status: 'waiting' }],
      { assignedTo: 'builder', status: 'in_progress' },
    ],
    [
      'persistent offline + pending task (needs manual start)',
      [{ role: 'builder', status: 'offline' }],
      { assignedTo: 'builder', status: 'pending' },
    ],
    [
      'ephemeral architect offline + in_progress',
      [{ role: 'architect', status: 'offline' }],
      { assignedTo: 'architect', status: 'in_progress' },
    ],
    [
      'ephemeral architect error + pending',
      [{ role: 'architect', status: 'error' }],
      { assignedTo: 'architect', status: 'pending' },
    ],
    [
      'mixed-case assignee Builder with lowercase offline row',
      [{ role: 'builder', status: 'offline' }],
      { assignedTo: 'Builder', status: 'in_progress' },
    ],
  ] as const)('%s -> stuck status', async (name, rows, task) => {
    const { sessionId } = await createTestSession(`stuck-${name}`);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await seed(chatroomId, rows as any, task as any);
    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });
    expect(result.activityStatus).toBe(STUCK);
  });

  test('control: offline role with NO task keeps idle (must stay green after fix)', async () => {
    const { sessionId } = await createTestSession('stuck-control-no-task');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await seed(chatroomId, [{ role: 'builder', status: 'offline' }]);
    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });
    expect(result.activityStatus).toBe('idle');
  });

  test('control: completed chatroom keeps precedence', async () => {
    const { sessionId } = await createTestSession('stuck-control-completed');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await t.run(async (ctx) => ctx.db.patch(chatroomId, { status: 'completed' }));
    await seed(chatroomId, [{ role: 'builder', status: 'offline' }], {
      assignedTo: 'builder',
      status: 'in_progress',
    });
    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });
    expect(result.activityStatus).toBe('completed');
  });

  test.each([
    [
      'ephemeral architect offline + pending stays idle (on-demand start)',
      [{ role: 'architect', status: 'offline' }],
      { assignedTo: 'architect', status: 'pending' },
      'idle',
    ],
    [
      'starting assignee + pending stays transitioning',
      [{ role: 'builder', status: 'starting' }],
      { assignedTo: 'builder', status: 'pending' },
      'transitioning',
    ],
    [
      'waiting assignee + in_progress stays active',
      [{ role: 'builder', status: 'waiting' }],
      { assignedTo: 'builder', status: 'in_progress' },
      'active',
    ],
  ] as const)('control: %s', async (_name, rows, task, expected) => {
    const { sessionId } = await createTestSession(`stuck-control-${_name}`);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await seed(chatroomId, rows as any, task as any);
    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });
    expect(result.activityStatus).toBe(expected);
  });

  test('stuck room maps to attention, stays stoppable, and keeps remoteAgentStatus none', async () => {
    const { sessionId } = await createTestSession('stuck-state-contract');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await seed(chatroomId, [{ role: 'builder', status: 'offline' }], {
      assignedTo: 'builder',
      status: 'in_progress',
    });
    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });
    expect(result.activityStatus).toBe('stuck');
    expect(result.state).toBe('attention');
    expect(result.canStop).toBe(true);
    expect(result.remoteAgentStatus).toBe('none');
  });
});
