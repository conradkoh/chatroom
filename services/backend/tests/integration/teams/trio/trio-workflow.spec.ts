/**
 * Trio Team — Coordinator-Centred Workflow
 *
 * Verifies the trio handoff graph and per-edge session policy end to end
 * through the public Convex APIs: the specifier init prompt, every accepted
 * edge, the delivery targets and primary target each role advertises, the
 * `taskEnvelope.sessionPolicy` of every created task, and the rejection of an
 * out-of-contract edge without writes.
 *
 * Expected values are literal: the graph and session policy are the product
 * contract under test, not a projection of the backend's rule table.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { createTestSession, joinParticipant } from '../../../helpers/integration';

const TRIO_ROLES = ['coordinator', 'specifier', 'builder'] as const;
type TrioRole = (typeof TRIO_ROLES)[number];

async function createTrioChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'trio',
  });
  for (const role of TRIO_ROLES) {
    await joinParticipant(sessionId, chatroomId, role);
  }
  return chatroomId;
}

/** Claim and read a task the way the daemon delivers it (pending → in_progress). */
async function receiveTask(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: TrioRole,
  taskId: Id<'chatroom_tasks'>
): Promise<void> {
  await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role, taskId });
  await t.mutation(api.tasks.readTask, { sessionId, chatroomId, role, taskId });
}

async function handoff(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: TrioRole,
  targetRole: string
) {
  return await t.mutation(api.messages.handoff, {
    sessionId,
    chatroomId,
    senderRole,
    content: `${senderRole} to ${targetRole}`,
    targetRole,
  });
}

async function getTask(taskId: Id<'chatroom_tasks'>) {
  const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
  if (!task) throw new Error(`Task ${taskId} not found`);
  return task;
}

async function getDeliveryOutput(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: TrioRole,
  taskId: Id<'chatroom_tasks'>,
  messageId: Id<'chatroom_messages'>
): Promise<string> {
  const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
    sessionId,
    chatroomId,
    role,
    taskId,
    messageId,
    convexUrl: 'http://127.0.0.1:3210',
  });
  return fullCliOutput;
}

/** Extract the body of a top-level delivery section such as `<handoffs>`. */
function section(output: string, tag: 'handoffs' | 'next-steps'): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = output.indexOf(open);
  const end = output.indexOf(close, start + open.length);
  if (start === -1 || end === -1) throw new Error(`Missing ${open} section`);
  return output.slice(start + open.length, end);
}

/** Role names advertised inside the `<handoffs>` block, in order. */
function advertisedTargets(output: string): string[] {
  return [...section(output, 'handoffs').matchAll(/^\*\*([a-z-]+)\*\*/gm)].map(
    (match) => match[1]!
  );
}

async function countChatroomRows(
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ tasks: number; messages: number }> {
  return await t.run(async (ctx) => {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return { tasks: tasks.length, messages: messages.length };
  });
}

describe('Trio Team > Coordinator-Centred Workflow', () => {
  test('specifier init prompt advertises the trio operating model and contract targets', async () => {
    const { sessionId } = await createTestSession('trio-workflow-init');
    const chatroomId = await createTrioChatroom(sessionId);

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'specifier',
      convexUrl: 'http://127.0.0.1:3210',
    });
    const prompt = initPrompt?.prompt ?? '';

    expect(prompt).toContain('# Trio');
    expect(prompt).toContain('## Specifier Operating Model');
    expect(prompt).toContain('Available targets: coordinator, builder');
    expect(prompt).toContain('chatroom messages download');
  });

  test('routes coordination through the coordinator with per-edge session policy', async () => {
    const { sessionId } = await createTestSession('trio-workflow');
    const chatroomId = await createTrioChatroom(sessionId);

    // Step 2: the coordinator receives a user message and delegates to the
    // specifier. The specifier starts a fresh session and advertises only its
    // contract targets, returning upstream to the coordinator by default.
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Plan and implement the trio workflow',
      type: 'message',
    });
    const coordinatorTask = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'coordinator',
    });
    await receiveTask(sessionId, chatroomId, 'coordinator', coordinatorTask.taskId);

    const toSpecifier = await handoff(sessionId, chatroomId, 'coordinator', 'specifier');
    expect(toSpecifier.success).toBe(true);
    const specifierTask = await getTask(toSpecifier.newTaskId!);
    expect(specifierTask.assignedTo).toBe('specifier');
    expect(specifierTask.taskEnvelope?.sessionPolicy).toBe('new');
    expect(specifierTask.startInNewSession).toBe(true);

    await receiveTask(sessionId, chatroomId, 'specifier', specifierTask._id);
    const specifierOutput = await getDeliveryOutput(
      sessionId,
      chatroomId,
      'specifier',
      specifierTask._id,
      toSpecifier.messageId!
    );
    expect(advertisedTargets(specifierOutput)).toEqual(['coordinator', 'builder']);
    expect(section(specifierOutput, 'next-steps')).toContain('--next-role="coordinator"');

    // Step 3: the specifier delegates the brief to the builder. The builder
    // starts a fresh session and advertises only the specifier.
    const toBuilder = await handoff(sessionId, chatroomId, 'specifier', 'builder');
    expect(toBuilder.success).toBe(true);
    const builderTask = await getTask(toBuilder.newTaskId!);
    expect(builderTask.assignedTo).toBe('builder');
    expect(builderTask.taskEnvelope?.sessionPolicy).toBe('new');

    await receiveTask(sessionId, chatroomId, 'builder', builderTask._id);
    const builderOutput = await getDeliveryOutput(
      sessionId,
      chatroomId,
      'builder',
      builderTask._id,
      toBuilder.messageId!
    );
    expect(advertisedTargets(builderOutput)).toEqual(['specifier']);

    // Step 4: the builder hands back to the specifier, continuing its session.
    const backToSpecifier = await handoff(sessionId, chatroomId, 'builder', 'specifier');
    expect(backToSpecifier.success).toBe(true);
    const specifierReworkTask = await getTask(backToSpecifier.newTaskId!);
    expect(specifierReworkTask.assignedTo).toBe('specifier');
    expect(specifierReworkTask.taskEnvelope?.sessionPolicy).toBe('continue');

    // Step 5: the specifier reports to the coordinator, continuing the
    // coordinator's session; the coordinator then delivers to the user.
    await receiveTask(sessionId, chatroomId, 'specifier', specifierReworkTask._id);
    const toCoordinator = await handoff(sessionId, chatroomId, 'specifier', 'coordinator');
    expect(toCoordinator.success).toBe(true);
    const coordinatorReportTask = await getTask(toCoordinator.newTaskId!);
    expect(coordinatorReportTask.assignedTo).toBe('coordinator');
    expect(coordinatorReportTask.taskEnvelope?.sessionPolicy).toBe('continue');

    await receiveTask(sessionId, chatroomId, 'coordinator', coordinatorReportTask._id);
    const toUser = await handoff(sessionId, chatroomId, 'coordinator', 'user');
    expect(toUser.success).toBe(true);
    expect(toUser.newTaskId).toBeNull();

    // Step 6: the specifier may not address the user directly. The rejection
    // happens before any write, so tasks and messages are unchanged.
    const before = await countChatroomRows(chatroomId);
    const rejected = await handoff(sessionId, chatroomId, 'specifier', 'user');

    expect(rejected).toEqual({
      success: false,
      error: {
        code: 'INVALID_TARGET_ROLE',
        message: expect.any(String),
        suggestedTargets: ['coordinator', 'builder'],
      },
      messageId: null,
      completedTaskIds: [],
      newTaskId: null,
      promotedTaskId: null,
      supportsNativeIntegration: false,
      attachmentsDiscarded: false,
    });
    expect(await countChatroomRows(chatroomId)).toEqual(before);
  });
});
