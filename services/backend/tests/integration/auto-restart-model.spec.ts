/**
 * Auto-restart Model Selection Tests
 *
 * Tests that when agents are auto-restarted (triggered by sending a message
 * while agents are offline), the correct model is used — specifically the
 * last model the user selected, not the default.
 *
 * Bug: auto-restart reads model from chatroom_teamAgentConfigs, which can
 * be overwritten with undefined by register-agent or sendCommand without model.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function registerMachine(
  sessionId: SessionId,
  machineId: string
): Promise<{ machineId: string }> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    availableModels: ['claude-sonnet-4', 'claude-opus-4', 'gpt-4o'],
  });
  // Mark daemon as connected
  await t.mutation(api.machines.updateDaemonStatus, {
    sessionId,
    machineId,
    connected: true,
  });
  return { machineId };
}

/**
 * Get all pending machine commands for a given machine
 */
async function getPendingCommands(sessionId: SessionId, machineId: string) {
  const result = await t.query(api.machines.getPendingCommands, {
    sessionId,
    machineId,
  });
  return result.commands;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Auto-restart Model Selection', () => {
  test('auto-restart preserves model from last webapp start', async () => {
    // ===== SETUP =====
    // Use pair team where builder is entry point — user message targets builder directly
    const { sessionId } = await createTestSession('test-auto-restart-model-1');
    const chatroomId = await createPairChatroom(sessionId);
    const { machineId } = await registerMachine(sessionId, 'machine-model-test-1');

    // ===== START AGENT WITH SPECIFIC MODEL =====
    // Simulate webapp starting the builder agent with claude-opus-4
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-opus-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
      },
    });

    // Ack all pending commands so they're no longer pending
    const startCommands = await getPendingCommands(sessionId, machineId);
    for (const cmd of startCommands) {
      await t.mutation(api.machines.ackCommand, {
        sessionId,
        commandId: cmd._id,
        status: 'completed' as const,
      });
    }

    // Builder is NOT joined as participant (offline) — this triggers auto-restart

    // ===== SEND USER MESSAGE (triggers auto-restart for offline builder) =====
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Please implement the feature',
      senderRole: 'user',
      type: 'message' as const,
    });

    // ===== VERIFY: auto-restart command should use claude-opus-4 =====
    const pendingAfterMessage = await getPendingCommands(sessionId, machineId);
    const startAgentCmd = pendingAfterMessage.find((c) => c.type === 'start-agent');

    expect(startAgentCmd).toBeDefined();
    expect(startAgentCmd!.payload.model).toBe('claude-opus-4');
    expect(startAgentCmd!.payload.role).toBe('builder');
  });

  test('auto-restart preserves model even after register-agent overwrites team config', async () => {
    // ===== SETUP =====
    // Use pair team where builder is entry point
    const { sessionId } = await createTestSession('test-auto-restart-model-2');
    const chatroomId = await createPairChatroom(sessionId);
    const { machineId } = await registerMachine(sessionId, 'machine-model-test-2');

    // ===== START AGENT WITH SPECIFIC MODEL =====
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-opus-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
      },
    });

    // Ack all pending commands
    const allCmds1 = await getPendingCommands(sessionId, machineId);
    for (const cmd of allCmds1) {
      await t.mutation(api.machines.ackCommand, {
        sessionId,
        commandId: cmd._id,
        status: 'completed' as const,
      });
    }

    // ===== REGISTER-AGENT OVERWRITES TEAM CONFIG WITHOUT MODEL =====
    // This simulates what happens when the CLI's register-agent runs
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      workingDir: '/test/workspace',
      // NOTE: no model field — this is the bug trigger
    });

    // Builder is NOT joined as participant (offline)

    // ===== SEND USER MESSAGE (triggers auto-restart) =====
    await t.mutation(api.messages.send, {
      sessionId,
      chatroomId,
      content: 'Please implement the feature',
      senderRole: 'user',
      type: 'message' as const,
    });

    // ===== VERIFY: auto-restart should still use claude-opus-4 =====
    const pendingAfterMessage = await getPendingCommands(sessionId, machineId);
    const startAgentCmd = pendingAfterMessage.find((c) => c.type === 'start-agent');

    expect(startAgentCmd).toBeDefined();
    expect(startAgentCmd!.payload.model).toBe('claude-opus-4');
  });
});
