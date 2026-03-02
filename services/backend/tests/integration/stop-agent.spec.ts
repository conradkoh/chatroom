/**
 * Stop Agent — Integration Tests
 *
 * Tests the `stopAgent` use case which dispatches a stop-agent request
 * to the machine daemon via the event stream.
 */

import { describe, expect, test } from 'vitest';

import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getCommandEvents,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('stopAgent', () => {
  test('dispatches an agent.requestStop event with correct payload', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-stop-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-stop-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        reason: 'test',
      });
    });

    // ===== VERIFY =====
    const events = await getCommandEvents(sessionId, machineId);
    const stopEvt = events.find((e) => e.type === 'agent.requestStop');
    expect(stopEvt).toBeDefined();
    if (stopEvt && stopEvt.type === 'agent.requestStop') {
      expect(stopEvt.chatroomId).toBe(chatroomId);
      expect(stopEvt.role).toBe('builder');
      expect(stopEvt.reason).toBe('test');
      expect(typeof stopEvt.deadline).toBe('number');
    }
  });

  test('returns empty result (no command ID needed for event-stream delivery)', async () => {
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
        reason: 'test',
      });
    });

    // stopAgent no longer returns a commandId — event stream is the delivery path
    expect(result).toBeDefined();
    expect((result as { commandId?: unknown }).commandId).toBeUndefined();
  });

  test('multiple stop events can be dispatched independently', async () => {
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
        reason: 'test',
      });
      await stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'reviewer',
        userId: user!._id,
        reason: 'test',
      });
    });

    // ===== VERIFY =====
    const events = await getCommandEvents(sessionId, machineId);
    const stopEvts = events.filter((e) => e.type === 'agent.requestStop');
    expect(stopEvts.length).toBe(2);

    const roles = stopEvts
      .filter((e) => e.type === 'agent.requestStop')
      .map((e) => (e as { role: string }).role)
      .sort();
    expect(roles).toEqual(['builder', 'reviewer']);
  });
});
