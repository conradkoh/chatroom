/**
 * sendCommand stop-agent reason pass-through — Integration Tests
 *
 * Verifies that the `sendCommand` mutation correctly handles the optional
 * `reason` field for stop-agent commands:
 * - Defaults to 'user.stop' when no reason is provided
 * - Passes through explicit reasons from the caller
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getCommandEvents,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

describe('sendCommand stop-agent reason', () => {
  test('defaults to user.stop when no reason is provided', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-cmd-stop-default-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-cmd-stop-default-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // ===== ACTION =====
    // Call sendCommand without a reason field — should default to 'user.stop'
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'stop-agent',
      payload: {
        chatroomId,
        role: 'builder',
      },
    });

    // ===== VERIFY =====
    const events = await getCommandEvents(sessionId, machineId);
    const stopEvt = events.find((e) => e.type === 'agent.requestStop');
    expect(stopEvt).toBeDefined();
    if (stopEvt && stopEvt.type === 'agent.requestStop') {
      expect(stopEvt.reason).toBe('user.stop');
    }
  });

  test('passes through explicit reason from caller', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-cmd-stop-reason-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-cmd-stop-reason-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // ===== ACTION =====
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'stop-agent',
      payload: {
        chatroomId,
        role: 'builder',
        reason: 'platform.dedup',
      },
    });

    // ===== VERIFY =====
    const events = await getCommandEvents(sessionId, machineId);
    const stopEvt = events.find((e) => e.type === 'agent.requestStop');
    expect(stopEvt).toBeDefined();
    if (stopEvt && stopEvt.type === 'agent.requestStop') {
      expect(stopEvt.reason).toBe('platform.dedup');
    }
  });
});
