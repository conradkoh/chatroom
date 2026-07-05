/**
 * Unit tests for startTaskFromTokenActivity
 * Tests conditional resume logic without full harness integration.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { startTaskFromTokenActivity } from './start-task-from-token-activity';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import { TEST_MODEL_OPENCODE } from '../../../../tests/helpers/test-models';
import {
  GET_NEXT_TASK_STOPPED_ACTION,
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '../../entities/participant';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

async function joinParticipant(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
    action: 'get-next-task:started',
  });
}

async function seedAcknowledgedTask(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  content = 'acknowledged task'
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'acknowledged',
      assignedTo: role,
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
  });
}

async function seedPendingTask(
  chatroomId: Id<'chatroom_rooms'>,
  opts: {
    assignedTo: string;
    queuePosition: number;
    content?: string;
    sourceMessageId?: Id<'chatroom_messages'>;
  }
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: opts.content ?? 'pending task',
      status: 'pending',
      assignedTo: opts.assignedTo,
      createdAt: now,
      updatedAt: now,
      queuePosition: opts.queuePosition,
      sourceMessageId: opts.sourceMessageId,
    });
  });
}

async function seedNativeHarnessConfig(chatroomId: Id<'chatroom_rooms'>, role: string) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', role),
      chatroomId,
      role,
      type: 'remote',
      machineId: `machine-native-${role}`,
      agentHarness: 'pi-sdk',
      model: TEST_MODEL_OPENCODE,
      workingDir: '/tmp/test',
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedAcknowledgedSourceMessage(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'Previously claimed user message',
      type: 'message',
      acknowledgedAt: now,
    });
  });
}

async function getTaskStatus(taskId: Id<'chatroom_tasks'>) {
  return t.run(async (ctx) => {
    const task = await ctx.db.get('chatroom_tasks', taskId);
    return task?.status ?? null;
  });
}

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return p?.lastStatus ?? null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startTaskFromTokenActivity — acknowledged path', () => {
  test('starts acknowledged task when lastStatus is agent.waiting', async () => {
    const { sessionId } = await createTestSession('stta-waiting');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting' }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
    expect(await getParticipantStatus(chatroomId, 'builder')).toBe('task.inProgress');
  });

  test('starts acknowledged task when lastStatus is task.acknowledged', async () => {
    const { sessionId } = await createTestSession('stta-ack');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'task.acknowledged' }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
  });

  test('starts acknowledged task when lastSeenAction is native:task-injected', async () => {
    const { sessionId } = await createTestSession('stta-injected');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.started', lastSeenAction: NATIVE_TASK_INJECTED_ACTION }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
  });

  test('starts acknowledged task when lastSeenAction is get-next-task:stopped', async () => {
    const { sessionId } = await createTestSession('stta-stopped');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.started', lastSeenAction: GET_NEXT_TASK_STOPPED_ACTION }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
  });

  test('does not start when acknowledged task exists but participant state does not match triggers', async () => {
    const { sessionId } = await createTestSession('stta-no-trigger');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.exited', lastSeenAction: 'native:waiting' }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('acknowledged');
  });
});

describe('startTaskFromTokenActivity — pending path', () => {
  test('claims and starts lowest queuePosition pending task when agent.waiting', async () => {
    const { sessionId } = await createTestSession('stta-pending-order');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const higherPosition = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 2,
      content: 'second',
    });
    const lowerPosition = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 1,
      content: 'first',
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting' }
      );
    });

    expect(await getTaskStatus(lowerPosition)).toBe('in_progress');
    expect(await getTaskStatus(higherPosition)).toBe('pending');
    expect(await getParticipantStatus(chatroomId, 'builder')).toBe('task.inProgress');
  });

  test('no-ops when lastStatus is not agent.waiting and no acknowledged path', async () => {
    const { sessionId } = await createTestSession('stta-pending-noop');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.started' }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('pending');
  });

  test('no-ops when agent.waiting but no pending tasks', async () => {
    const { sessionId } = await createTestSession('stta-pending-none');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting' }
      );
    });

    expect(await getParticipantStatus(chatroomId, 'builder')).not.toBe('task.inProgress');
  });

  test('does not claim fresh pending task for native-integration harness on token activity', async () => {
    const { sessionId } = await createTestSession('stta-pending-native-skip');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await seedNativeHarnessConfig(chatroomId, 'builder');

    const taskId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
      content: 'native pending task',
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting' }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('pending');
    expect(await getParticipantStatus(chatroomId, 'builder')).not.toBe('task.inProgress');
  });

  test('claims released pending task for native harness when source message was previously acknowledged', async () => {
    const { sessionId } = await createTestSession('stta-pending-native-resume');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await seedNativeHarnessConfig(chatroomId, 'builder');
    const sourceMessageId = await seedAcknowledgedSourceMessage(chatroomId);

    const taskId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
      content: 'released native pending task',
      sourceMessageId,
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting', lastSeenAction: NATIVE_WAITING_ACTION }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
    expect(await getParticipantStatus(chatroomId, 'builder')).toBe('task.inProgress');
  });

  test('resumes native pending task when participant still shows stale task.inProgress after release', async () => {
    const { sessionId } = await createTestSession('stta-pending-native-stale-participant');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await seedNativeHarnessConfig(chatroomId, 'builder');

    const taskId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
      content: 'released with stale participant',
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'task.inProgress', lastSeenAction: NATIVE_WAITING_ACTION }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
    expect(await getParticipantStatus(chatroomId, 'builder')).toBe('task.inProgress');
  });

  test('resumes native pending task on agent.started before native:waiting is emitted', async () => {
    const { sessionId } = await createTestSession('stta-pending-native-agent-started');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await seedNativeHarnessConfig(chatroomId, 'builder');
    const sourceMessageId = await seedAcknowledgedSourceMessage(chatroomId);

    const taskId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
      content: 'token before native waiting',
      sourceMessageId,
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.started', lastSeenAction: NATIVE_WAITING_ACTION }
      );
    });

    expect(await getTaskStatus(taskId)).toBe('in_progress');
    expect(await getParticipantStatus(chatroomId, 'builder')).toBe('task.inProgress');
  });
});

describe('startTaskFromTokenActivity — precedence', () => {
  test('prefers acknowledged path over pending when both could apply', async () => {
    const { sessionId } = await createTestSession('stta-precedence');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const acknowledgedId = await seedAcknowledgedTask(chatroomId, 'builder', 'ack task');
    const pendingId = await seedPendingTask(chatroomId, {
      assignedTo: 'builder',
      queuePosition: 0,
      content: 'pending task',
    });

    await t.run(async (ctx) => {
      await startTaskFromTokenActivity(
        ctx,
        { chatroomId, role: 'builder' },
        { lastStatus: 'agent.waiting' }
      );
    });

    expect(await getTaskStatus(acknowledgedId)).toBe('in_progress');
    expect(await getTaskStatus(pendingId)).toBe('pending');
  });
});
