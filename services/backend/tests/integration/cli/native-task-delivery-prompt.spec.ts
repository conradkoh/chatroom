/**
 * Native Task Delivery Prompt — Integration Tests
 *
 * End-to-end getTaskDeliveryPrompt for native harnesses. Scenario matrix
 * detail is documented in tests/unit/prompts/native-workflow-disclosure.test.ts.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';
import { assertNativeDeliveryContract } from '../../helpers/native-delivery-contract';
import { assertNativeDeliveryScenario } from '../../helpers/native-workflow-assertions';
import {
  getNativeDeliveryScenario,
  NATIVE_AGENT_HARNESSES,
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
  agentHarness: NativeAgentHarness
): Promise<void> {
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId,
    role,
    type: 'remote',
    machineId: `machine-native-delivery-${role}`,
    agentHarness,
    model: 'auto',
    workingDir: '/test/workspace',
  });
}

interface DeliveryFixture {
  team: keyof typeof TEAM_CONFIGS;
  receivingRole: string;
  senderRole: string;
  taskContent: string;
  /** Substring matched against NATIVE_DELIVERY_SCENARIOS[].label */
  scenarioMatch: string;
}

/** Integration fixtures aligned with NATIVE_DELIVERY_SCENARIOS rows. */
const DELIVERY_INTEGRATION_FIXTURES: DeliveryFixture[] = [
  {
    team: 'solo',
    receivingRole: 'solo',
    senderRole: 'user',
    taskContent: 'Solo user task',
    scenarioMatch: 'solo receives user task',
  },
  {
    team: 'duo',
    receivingRole: 'planner',
    senderRole: 'user',
    taskContent: 'Planner user task',
    scenarioMatch: 'duo planner receives user task',
  },
  {
    team: 'duo',
    receivingRole: 'builder',
    senderRole: 'planner',
    taskContent: 'Builder implementation task',
    scenarioMatch:
      'duo builder receives planner task even when planner not in waiting-participants list',
  },
];

function findScenario(match: string) {
  return getNativeDeliveryScenario(match);
}

describe('Native task delivery prompt (integration)', () => {
  for (const agentHarness of NATIVE_AGENT_HARNESSES) {
    for (const fixture of DELIVERY_INTEGRATION_FIXTURES) {
      test(`${agentHarness} ${fixture.team}/${fixture.receivingRole} ← ${fixture.senderRole}`, async () => {
        const sessionKey = `native-delivery-${agentHarness}-${fixture.team}-${fixture.receivingRole}`;
        const { sessionId } = await createTestSession(sessionKey);
        const chatroomId = await createTeamChatroom(sessionId, fixture.team);
        await joinParticipants(sessionId, chatroomId, TEAM_CONFIGS[fixture.team].joinRoles);
        await saveNativeAgentConfig(sessionId, chatroomId, fixture.receivingRole, agentHarness);

        const messageId = await t.mutation(api.messages.sendMessage, {
          sessionId,
          chatroomId,
          senderRole: fixture.senderRole,
          content: fixture.taskContent,
          targetRole: fixture.receivingRole,
          type: 'message',
        });

        const { taskId } = await t.mutation(api.tasks.createTask, {
          sessionId,
          chatroomId,
          content: fixture.taskContent,
          createdBy: fixture.senderRole,
          sourceMessageId: messageId,
        });

        const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
          sessionId,
          chatroomId,
          role: fixture.receivingRole,
          taskId,
          messageId,
          convexUrl: 'http://127.0.0.1:3210',
        });

        const scenario = findScenario(fixture.scenarioMatch);
        assertNativeDeliveryContract(fullCliOutput, {
          taskContent: fixture.taskContent,
          handoffTarget: scenario.primaryHandoffTarget,
        });
        assertNativeDeliveryScenario(fullCliOutput, scenario);
      });
    }
  }

  test('resolves user message via task.sourceMessageId when messageId omitted', async () => {
    const { sessionId } = await createTestSession('test-native-delivery-no-message-id');
    const chatroomId = await createTeamChatroom(sessionId, 'duo');
    await joinParticipants(sessionId, chatroomId, ['planner']);
    await saveNativeAgentConfig(sessionId, chatroomId, 'planner', 'opencode-sdk');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'checkout master and run git pull',
      targetRole: 'planner',
      type: 'message',
    });

    const tasks = await t.query(api.tasks.listTasks, { sessionId, chatroomId });
    const taskId = tasks.find(
      (task: { sourceMessageId?: string }) => task.sourceMessageId === messageId
    )?._id;
    expect(taskId).toBeDefined();

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(fullCliOutput).toContain('sender="user"');
    expect(fullCliOutput).toContain('checkout master and run git pull');
    expect(fullCliOutput).not.toContain('Classify');
  });

  test('CLI harness delivery still contains get-next-task (regression)', async () => {
    const { sessionId } = await createTestSession('test-native-delivery-opencode-cli');
    const chatroomId = await createTeamChatroom(sessionId, 'duo');
    await joinParticipants(sessionId, chatroomId, ['builder']);

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

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(fullCliOutput).toContain('get-next-task');
    expect(fullCliOutput).toContain('<handoffs>');
    expect(fullCliOutput).toContain('you MUST run the handoff command');
  });
});
