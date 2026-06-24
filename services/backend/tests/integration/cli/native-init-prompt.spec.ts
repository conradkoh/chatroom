/**
 * Native Init Prompt — Integration Tests
 *
 * Verifies getInitPrompt for configured native harnesses matches the slim
 * init contract. Unit-level disclosure detail lives in
 * tests/unit/prompts/native-init-disclosure.test.ts.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { generateHandoffOutput } from '../../../prompts/generator';
import { t } from '../../../test.setup';
import { assertNativeInitContract } from '../../helpers/native-init-contract';
import { assertNativeInitTemplateDisclosure } from '../../helpers/native-workflow-assertions';
import {
  NATIVE_AGENT_HARNESSES,
  NATIVE_INIT_SCENARIOS,
  TEAM_CONFIGS,
  type NativeAgentHarness,
} from '../../helpers/native-workflow-fixtures';

async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

async function createTeamChatroom(
  sessionId: SessionId,
  team: keyof typeof TEAM_CONFIGS
): Promise<Id<'chatroom_rooms'>> {
  const config = TEAM_CONFIGS[team];
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: config.teamId,
    teamName: config.teamName,
    teamRoles: config.teamRoles,
    teamEntryPoint: config.teamEntryPoint,
  });
}

async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  for (const role of roles) {
    await t.mutation(api.participants.join, { sessionId, chatroomId, role });
  }
}

async function saveNativeAgentConfig(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  agentHarness: NativeAgentHarness,
  machineSuffix: string
): Promise<void> {
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId,
    role,
    type: 'remote',
    machineId: `machine-native-${machineSuffix}`,
    agentHarness,
    model: 'auto',
    workingDir: '/test/workspace',
  });
}

async function getInitPromptText(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<string> {
  const initPrompt = await t.query(api.messages.getInitPrompt, {
    sessionId,
    chatroomId,
    role,
    convexUrl: 'http://127.0.0.1:3210',
  });
  return initPrompt?.rolePrompt ?? initPrompt?.prompt ?? '';
}

describe('Native init prompt (integration)', () => {
  for (const agentHarness of NATIVE_AGENT_HARNESSES) {
    for (const scenario of NATIVE_INIT_SCENARIOS) {
      test(`${agentHarness} ${scenario.team}/${scenario.role} matches slim init contract`, async () => {
        const sessionKey = `test-native-init-${agentHarness}-${scenario.team}-${scenario.role}`;
        const { sessionId } = await createTestSession(sessionKey);
        const chatroomId = await createTeamChatroom(sessionId, scenario.team);
        await joinParticipants(sessionId, chatroomId, TEAM_CONFIGS[scenario.team].joinRoles);
        await saveNativeAgentConfig(
          sessionId,
          chatroomId,
          scenario.role,
          agentHarness,
          `${agentHarness}-${scenario.team}-${scenario.role}`
        );

        const prompt = await getInitPromptText(sessionId, chatroomId, scenario.role);

        assertNativeInitContract(prompt, {
          entryPoint: scenario.entryPoint,
          soloTeam: scenario.soloTeam,
          noTaskRead: scenario.noTaskRead,
        });
        assertNativeInitTemplateDisclosure(prompt, {
          referencesDeliveryTemplates: scenario.referencesDeliveryTemplates,
        });
      });
    }
  }

  test('opencode CLI harness init prompt still contains get-next-task (regression)', async () => {
    const { sessionId } = await createTestSession('test-native-init-opencode-cli');
    const chatroomId = await createTeamChatroom(sessionId, 'duo');
    await joinParticipants(sessionId, chatroomId, ['builder']);

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

    const prompt = await getInitPromptText(sessionId, chatroomId, 'builder');
    expect(prompt).toContain('get-next-task');
    expect(prompt).toContain('Begin With the End in Mind');
  });

  test('native handoff confirmation omits get-next-task reminder', () => {
    const output = generateHandoffOutput({
      role: 'builder',
      nextRole: 'planner',
      chatroomId: 'test-chatroom-id',
      convexUrl: 'http://127.0.0.1:3210',
      supportsNativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).not.toContain('task injection');
    expect(output).not.toContain('Level A');
    expect(output).toContain('handed off to planner');
    expect(output).toContain('End your turn now');
    expect(output).toContain('messages list');
  });

  test('native planner handoff to builder tells agent to end turn and wait for handback', () => {
    const output = generateHandoffOutput({
      role: 'planner',
      nextRole: 'builder',
      chatroomId: 'test-chatroom-id',
      convexUrl: 'http://127.0.0.1:3210',
      supportsNativeIntegration: true,
    });

    expect(output).toContain('handed off to builder');
    expect(output).toContain('End your turn now');
    expect(output).toContain('builder');
    expect(output).toContain('messages list');
    expect(output).not.toContain('get-next-task');
  });
});
