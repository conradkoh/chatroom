/**
 * Auto-restart Deduplication Tests
 *
 * Tests that when multiple messages are sent to an offline agent in quick
 * succession, only a single stop+start command pair is created (not one
 * per message).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

async function createPairChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function registerMachineWithDaemon(
  sessionId: SessionId,
  machineId: string
): Promise<{ machineId: string }> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    availableModels: ['claude-sonnet-4'],
  });
  await t.mutation(api.machines.updateDaemonStatus, {
    sessionId,
    machineId,
    connected: true,
  });
  return { machineId };
}

/**
 * Set up a remote agent config so auto-restart knows this is a remote agent.
 * The agent is NOT joined as a participant (offline).
 */
async function setupRemoteAgentConfig(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  role: string
): Promise<void> {
  // Start agent via sendCommand to create both team and machine agent configs
  await t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role,
      model: 'claude-sonnet-4',
      agentHarness: 'opencode',
      workingDir: '/test/workspace',
    },
  });

  // Ack all commands so they're no longer pending
  const commands = (
    await t.query(api.machines.getPendingCommands, {
      sessionId,
      machineId,
    })
  ).commands;
  for (const cmd of commands) {
    await t.mutation(api.machines.ackCommand, {
      sessionId,
      commandId: cmd._id,
      status: 'completed' as const,
    });
  }
}

async function getPendingCommands(sessionId: SessionId, machineId: string) {
  const result = await t.query(api.machines.getPendingCommands, {
    sessionId,
    machineId,
  });
  return result.commands;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auto-restart Deduplication', () => {
  test('multiple messages to offline agent produce at most 1 stop+start pair', async () => {
    const { sessionId } = await createTestSession('test-dedup-1');
    const chatroomId = await createPairChatroom(sessionId);
    const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-dedup-1');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Builder is NOT joined as participant (offline)
    // Send 5 messages in quick succession — each triggers autoRestartOfflineAgent
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: `Message ${i + 1}: please do something`,
        senderRole: 'user',
        type: 'message' as const,
      });
    }

    // Verify: should have exactly 1 stop + 1 start command (not 5 pairs)
    const pending = await getPendingCommands(sessionId, machineId);
    const stopCommands = pending.filter((c: { type: string }) => c.type === 'stop-agent');
    const startCommands = pending.filter((c: { type: string }) => c.type === 'start-agent');

    expect(stopCommands.length).toBe(1);
    expect(startCommands.length).toBe(1);
  });

  test('first message still triggers auto-restart', async () => {
    const { sessionId } = await createTestSession('test-dedup-2');
    const chatroomId = await createPairChatroom(sessionId);
    const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-dedup-2');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Builder is NOT joined as participant (offline)
    // Send a single message
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Please implement the feature',
      senderRole: 'user',
      type: 'message' as const,
    });

    // Verify: should have exactly 1 stop + 1 start command
    const pending = await getPendingCommands(sessionId, machineId);
    const startCommands = pending.filter((c: { type: string }) => c.type === 'start-agent');

    expect(startCommands.length).toBe(1);
    expect(startCommands[0].payload.role).toBe('builder');
  });

  test('new restart allowed after previous commands are acked', async () => {
    const { sessionId } = await createTestSession('test-dedup-3');
    const chatroomId = await createPairChatroom(sessionId);
    const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-dedup-3');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Builder is NOT joined as participant (offline)
    // First message triggers restart
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'First message',
      senderRole: 'user',
      type: 'message' as const,
    });

    // Ack all pending commands (simulating daemon processing them)
    const firstBatch = await getPendingCommands(sessionId, machineId);
    for (const cmd of firstBatch) {
      await t.mutation(api.machines.ackCommand, {
        sessionId,
        commandId: cmd._id,
        status: 'completed' as const,
      });
    }

    // Second message should trigger a NEW restart (no pending commands exist)
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Second message after ack',
      senderRole: 'user',
      type: 'message' as const,
    });

    const secondBatch = await getPendingCommands(sessionId, machineId);
    const startCommands = secondBatch.filter((c: { type: string }) => c.type === 'start-agent');

    expect(startCommands.length).toBe(1);
  });
});
