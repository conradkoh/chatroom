/**
 * P9 orchestration ingress — Integration Tests
 */

import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { TEST_MODEL_OPENCODE } from '../helpers/test-models';

const P9_USER = 'DAEMON_ORCHESTRATION_P9_USER_MESSAGE';
const P8 = 'DAEMON_ORCHESTRATION_P8';

function withP9UserMessage(): void {
  process.env[P9_USER] = '1';
  process.env[P8] = '1';
}

async function bindOrchestrationHost(args: {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workingDir: string;
}): Promise<void> {
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId: args.sessionId,
    chatroomId: args.chatroomId,
    role: 'builder',
    type: 'remote',
    machineId: args.machineId,
    agentHarness: 'opencode',
    model: TEST_MODEL_OPENCODE,
    workingDir: args.workingDir,
  });
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId: args.sessionId,
    chatroomId: args.chatroomId,
    role: 'planner',
    type: 'remote',
    machineId: args.machineId,
    agentHarness: 'opencode',
    model: TEST_MODEL_OPENCODE,
    workingDir: args.workingDir,
  });
}

describe('P9 orchestration ingress', () => {
  afterEach(() => {
    delete process.env[P9_USER];
    delete process.env[P8];
  });

  test('submitUserMessage inserts ingress row when P9 on and host bound', async () => {
    withP9UserMessage();
    const { sessionId } = await createTestSession('p9-ingress-submit');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p9-ingress-submit-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await bindOrchestrationHost({
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/test/workspace',
    });

    const { ingressId } = await t.mutation(api.orchestration.submitUserMessage, {
      sessionId,
      chatroomId,
      content: 'hello from ingress',
    });
    expect(ingressId).toBeTruthy();

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_orchestrationIngress')
        .withIndex('by_machineId_revisionKey', (q) => q.eq('machineId', machineId))
        .collect();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ingressId).toBe(ingressId);
  });

  test('subscribe returns ingress row for host machine', async () => {
    withP9UserMessage();
    const { sessionId } = await createTestSession('p9-ingress-subscribe');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p9-ingress-subscribe-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await bindOrchestrationHost({
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/test/workspace',
    });

    await t.mutation(api.orchestration.submitUserMessage, {
      sessionId,
      chatroomId,
      content: 'subscribe me',
    });

    const page = await t.query(api.orchestration.subscribeOrchestrationIngressSince, {
      sessionId,
      machineId,
      limit: 10,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.content).toBe('subscribe me');
  });

  test('submit rejected when host unbound', async () => {
    withP9UserMessage();
    const { sessionId } = await createTestSession('p9-ingress-unbound');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.mutation(api.orchestration.submitUserMessage, {
        sessionId,
        chatroomId,
        content: 'should fail',
      })
    ).rejects.toThrow(ConvexError);
  });

  test('projectUserMessageFromDaemon is idempotent', async () => {
    const { sessionId } = await createTestSession('p9-project-user-msg');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p9-project-user-msg-machine';
    await registerMachineWithDaemon(sessionId, machineId);

    const first = await t.mutation(api.messages.projectUserMessageFromDaemon, {
      sessionId,
      machineId,
      idempotencyKey: 'ingress-id-1',
      chatroomId,
      localMessageId: 'local-msg-1',
      localTaskId: 'local-task-1',
      content: 'projected message',
      assignedRole: 'planner',
      timestamp: Date.now(),
    });
    const second = await t.mutation(api.messages.projectUserMessageFromDaemon, {
      sessionId,
      machineId,
      idempotencyKey: 'ingress-id-1',
      chatroomId,
      localMessageId: 'local-msg-1',
      localTaskId: 'local-task-1',
      content: 'projected message',
      assignedRole: 'planner',
      timestamp: Date.now(),
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.messageId).toEqual(first.messageId);
  });
});
