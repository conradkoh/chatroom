/**
 * Native Init Prompt — Integration Tests
 *
 * Verifies that cursor-sdk / opencode-sdk init prompts omit get-next-task
 * and use native injection language, while CLI harnesses remain unchanged.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { generateHandoffOutput } from '../../../prompts/generator';
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

describe('Native init prompt', () => {
  test('cursor-sdk builder init prompt omits get-next-task and uses injection language', async () => {
    const { sessionId } = await createTestSession('test-native-init-cursor-sdk');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: 'machine-native-cursor-sdk',
      agentHarness: 'cursor-sdk',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    const prompt = initPrompt?.rolePrompt ?? initPrompt?.prompt ?? '';
    expect(prompt).not.toContain('get-next-task');
    expect(prompt.toLowerCase()).toMatch(/inject/);
  });

  test('opencode CLI harness init prompt still contains get-next-task (regression)', async () => {
    const { sessionId } = await createTestSession('test-native-init-opencode-cli');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: 'machine-native-opencode-cli',
      agentHarness: 'opencode',
      model: 'claude-sonnet-4',
      workingDir: '/test/workspace',
    });

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    const prompt = initPrompt?.rolePrompt ?? initPrompt?.prompt ?? '';
    expect(prompt).toContain('get-next-task');
  });

  test('opencode-sdk planner init prompt omits get-next-task and uses injection language', async () => {
    const { sessionId } = await createTestSession('test-native-init-opencode-sdk-planner');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'planner',
      type: 'remote',
      machineId: 'machine-native-opencode-sdk-planner',
      agentHarness: 'opencode-sdk',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    const prompt = initPrompt?.rolePrompt ?? initPrompt?.prompt ?? '';
    expect(prompt).not.toMatch(/run `get-next-task`/i);
    expect(prompt.toLowerCase()).toMatch(/inject/);
  });

  test('native handoff output omits get-next-task reminder', () => {
    const output = generateHandoffOutput({
      role: 'builder',
      nextRole: 'planner',
      chatroomId: 'test-chatroom-id',
      convexUrl: 'http://127.0.0.1:3210',
      supportsNativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).toContain('injected automatically');
  });
});
