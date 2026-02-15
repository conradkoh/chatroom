/**
 * Shared Integration Test Helpers
 *
 * Common setup utilities used across agent reliability integration tests.
 * Centralizes session creation, chatroom setup, machine registration,
 * and agent config helpers to avoid duplication.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

// ---------------------------------------------------------------------------
// Session & Chatroom
// ---------------------------------------------------------------------------

/**
 * Create and authenticate a test session via anonymous login.
 */
export async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Create a pair-team chatroom (builder + reviewer, entry point = builder).
 */
export async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/**
 * Join a participant to a chatroom with a given readyUntil timestamp.
 */
export async function joinParticipant(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  readyUntil: number
): Promise<void> {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
    readyUntil,
  });
}

// ---------------------------------------------------------------------------
// Machine & Agent Config
// ---------------------------------------------------------------------------

/**
 * Register a machine and mark its daemon as connected.
 */
export async function registerMachineWithDaemon(
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
 * Sends a start-agent command and immediately acks it so no pending commands remain.
 * The agent is NOT joined as a participant (offline).
 */
export async function setupRemoteAgentConfig(
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Get all pending machine commands for a given machine.
 */
export async function getPendingCommands(sessionId: SessionId, machineId: string) {
  const result = await t.query(api.machines.getPendingCommands, {
    sessionId,
    machineId,
  });
  return result.commands;
}
