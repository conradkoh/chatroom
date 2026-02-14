/**
 * Auto-restart Deduplication Tests
 *
 * Tests that when multiple messages are sent to an offline agent in quick
 * succession, only a single stop+start command pair is created (not one
 * per message).
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  getPendingCommands,
} from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auto-restart Deduplication', () => {
  test('multiple messages to offline agent produce at most 1 stop+start pair', async () => {
    const { sessionId } = await createTestSession('test-dedup-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
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
    const chatroomId = await createPairTeamChatroom(sessionId);
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
    const chatroomId = await createPairTeamChatroom(sessionId);
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
