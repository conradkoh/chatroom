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
  joinParticipant,
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

describe('Auto-restart with activeUntil', () => {
  test('active participant with expired activeUntil triggers auto-restart', async () => {
    const { sessionId } = await createTestSession('test-active-expired');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-active-expired');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder as active with an already-expired activeUntil
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() + 10 * 60 * 1000);

    // Transition to active with expired activeUntil
    await t.mutation(api.participants.updateStatus, {
      sessionId,
      chatroomId,
      role: 'builder',
      status: 'active',
      expiresAt: Date.now() - 10_000, // expired 10 seconds ago
    });

    // Verify participant is active with expired activeUntil
    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(participant).not.toBeNull();
    expect(participant!.status).toBe('active');
    expect(participant!.activeUntil).toBeLessThan(Date.now());

    // Send a message — should trigger auto-restart because active participant is expired
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Please do something',
      senderRole: 'user',
      type: 'message' as const,
    });

    // Verify auto-restart was triggered
    const pending = await getPendingCommands(sessionId, machineId);
    const startCommands = pending.filter((c: { type: string }) => c.type === 'start-agent');
    expect(startCommands.length).toBe(1);
  });

  test('active participant with valid activeUntil does NOT trigger auto-restart', async () => {
    const { sessionId } = await createTestSession('test-active-valid');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-active-valid');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder as active with a valid (future) activeUntil
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() + 10 * 60 * 1000);

    // Transition to active with valid activeUntil (1 hour from now)
    await t.mutation(api.participants.updateStatus, {
      sessionId,
      chatroomId,
      role: 'builder',
      status: 'active',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    });

    // Send a message — should NOT trigger auto-restart because active participant is valid
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Please do something',
      senderRole: 'user',
      type: 'message' as const,
    });

    // Verify NO auto-restart was triggered
    const pending = await getPendingCommands(sessionId, machineId);
    const startCommands = pending.filter((c: { type: string }) => c.type === 'start-agent');
    expect(startCommands.length).toBe(0);
  });
});
