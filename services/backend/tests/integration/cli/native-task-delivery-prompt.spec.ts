/**
 * Native Task Delivery Prompt — Integration Tests
 *
 * Verifies getTaskDeliveryPrompt for native harnesses omits get-next-task
 * and uses injection language, while CLI harnesses remain unchanged.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';

async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

async function createDuoTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function joinParticipant(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
  });
}

describe('Native task delivery prompt', () => {
  test('getTaskDeliveryPrompt for cursor-sdk builder omits get-next-task', async () => {
    const { sessionId } = await createTestSession('test-native-delivery-cursor-sdk');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: 'machine-native-delivery',
      agentHarness: 'cursor-sdk',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'Implement native task injection',
      targetRole: 'builder',
      type: 'message',
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Wire native task injection',
      createdBy: 'planner',
      sourceMessageId: messageId,
    });

    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    const fullOutput = taskDeliveryPrompt.fullCliOutput;
    expect(fullOutput).not.toContain('get-next-task');
    expect(fullOutput.toLowerCase()).toMatch(/inject/);
    expect(fullOutput).toContain('next task will be injected automatically');
  });

  test('getTaskDeliveryPrompt for CLI harness still contains get-next-task (regression)', async () => {
    const { sessionId } = await createTestSession('test-native-delivery-opencode-cli');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: 'machine-cli-delivery',
      agentHarness: 'opencode',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'Implement feature',
      targetRole: 'builder',
      type: 'message',
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'CLI task delivery',
      createdBy: 'planner',
      sourceMessageId: messageId,
    });

    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(taskDeliveryPrompt.fullCliOutput).toContain('get-next-task');
  });
});
