/**
 * Heartbeat Integration Tests
 *
 * Tests for the participants.heartbeat mutation that refreshes readyUntil
 * as part of the agent reliability / liveness detection system.
 */

import { describe, expect, test } from 'vitest';

import { HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Heartbeat', () => {
  test('heartbeat refreshes readyUntil for a participant', async () => {
    const { sessionId } = await createTestSession('test-heartbeat-refresh');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const connectionId = 'conn-1';
    const initialReadyUntil = Date.now() + 10_000; // short initial TTL for testing

    // Join with a known readyUntil and connectionId
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      readyUntil: initialReadyUntil,
      connectionId,
    });

    // Verify initial state
    const before = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(before).not.toBeNull();
    expect(before!.readyUntil).toBe(initialReadyUntil);
    expect(before!.connectionId).toBe(connectionId);

    // Send heartbeat
    await t.mutation(api.participants.heartbeat, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId,
    });

    // Verify readyUntil was refreshed (should be approximately now + HEARTBEAT_TTL_MS)
    const after = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(after).not.toBeNull();
    // readyUntil should now be greater than the initial value
    expect(after!.readyUntil).toBeGreaterThan(initialReadyUntil);
    // And it should be approximately now + HEARTBEAT_TTL_MS (within 5s tolerance)
    const expectedReadyUntil = Date.now() + HEARTBEAT_TTL_MS;
    expect(after!.readyUntil).toBeGreaterThan(expectedReadyUntil - 5_000);
    expect(after!.readyUntil).toBeLessThanOrEqual(expectedReadyUntil + 5_000);
  });

  test('heartbeat rejects stale connectionId', async () => {
    const { sessionId } = await createTestSession('test-heartbeat-stale');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const currentConnectionId = 'conn-current';
    const staleConnectionId = 'conn-stale';

    // Join with the current connectionId
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      readyUntil: Date.now() + HEARTBEAT_TTL_MS,
      connectionId: currentConnectionId,
    });

    // Attempt heartbeat with a stale connectionId — should throw
    await expect(
      t.mutation(api.participants.heartbeat, {
        sessionId,
        chatroomId,
        role: 'builder',
        connectionId: staleConnectionId,
      })
    ).rejects.toThrow(/connectionId mismatch/);
  });

  test('heartbeat throws when participant does not exist', async () => {
    const { sessionId } = await createTestSession('test-heartbeat-missing');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // No participant joined — heartbeat should fail
    await expect(
      t.mutation(api.participants.heartbeat, {
        sessionId,
        chatroomId,
        role: 'builder',
        connectionId: 'conn-any',
      })
    ).rejects.toThrow(/not found/);
  });

  test('join sets readyUntil when provided', async () => {
    const { sessionId } = await createTestSession('test-join-readyuntil');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const readyUntil = Date.now() + HEARTBEAT_TTL_MS;
    const connectionId = 'conn-join';

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      readyUntil,
      connectionId,
    });

    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(participant).not.toBeNull();
    expect(participant!.readyUntil).toBe(readyUntil);
    expect(participant!.connectionId).toBe(connectionId);
    expect(participant!.status).toBe('waiting');
  });
});
