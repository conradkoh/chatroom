/**
 * Stop Agent — Integration Tests
 *
 * Tests the `stopAgent` use case which dispatches a stop-agent command
 * to the machine daemon.
 */

import { describe, expect, test } from 'vitest';

import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getPendingCommands,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('stopAgent', () => {
  test('dispatches a stop-agent command with correct payload', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-stop-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-stop-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.commandId).toBeDefined();

    const commands = await getPendingCommands(sessionId, machineId);
    const stopCmd = commands.find((c) => c.type === 'stop-agent');
    expect(stopCmd).toBeDefined();
    expect(stopCmd!.payload.chatroomId).toBe(chatroomId);
    expect(stopCmd!.payload.role).toBe('builder');
    // Stop commands should NOT include model, agentHarness, or workingDir
    expect(stopCmd!.payload.model).toBeUndefined();
    expect(stopCmd!.payload.agentHarness).toBeUndefined();
    expect(stopCmd!.payload.workingDir).toBeUndefined();
  });

  test('returns the command ID for tracking', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-stop-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-stop-2';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'reviewer',
        userId: user!._id,
      });
    });

    // ===== VERIFY =====
    // Verify the returned commandId matches an actual command in the DB
    const allCommands = await getPendingCommands(sessionId, machineId);
    const matchingCmd = allCommands.find((c) => c._id === result.commandId);
    expect(matchingCmd).toBeDefined();
    expect(matchingCmd!.type).toBe('stop-agent');
  });

  test('multiple stop commands can be dispatched independently', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-stop-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-stop-3';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    // Dispatch stop for two different roles
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
      });
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'reviewer',
        userId: user!._id,
      });
    });

    // ===== VERIFY =====
    const commands = await getPendingCommands(sessionId, machineId);
    const stopCmds = commands.filter((c) => c.type === 'stop-agent');
    expect(stopCmds.length).toBe(2);

    const roles = stopCmds.map((c) => c.payload.role).sort();
    expect(roles).toEqual(['builder', 'reviewer']);
  });
});
