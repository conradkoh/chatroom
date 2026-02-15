/**
 * Integration tests for updateAgentStatus dead-state fallback.
 *
 * Verifies that updateAgentStatus:
 * - Creates a minimal participant record when the participant doesn't exist
 *   and the target status is a dead state (dead, dead_failed_revive, restarting)
 * - Throws PARTICIPANT_NOT_FOUND when the participant doesn't exist and the
 *   target status is NOT a dead state (e.g. offline)
 * - Patches an existing participant's status correctly
 */

import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';

import { BACKEND_ERROR_CODES, type BackendError } from '../../../config/errorCodes';
import { DEAD_STATES } from '../../../config/participantStates';
import { api } from '../../../convex/_generated/api';
import { t } from '../../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  joinParticipant,
} from '../../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract BackendError data from a ConvexError.
 * In convex-test, the error data may be serialized as a JSON string.
 */
function extractErrorData(error: unknown): BackendError {
  expect(error).toBeInstanceOf(ConvexError);
  const raw = (error as ConvexError<unknown>).data;
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return data as BackendError;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateAgentStatus', () => {
  describe('dead-state fallback (participant does not exist)', () => {
    for (const deadState of DEAD_STATES) {
      test(`creates minimal participant record for dead state "${deadState}"`, async () => {
        const { sessionId } = await createTestSession(`update-status-${deadState}-${Date.now()}`);
        const chatroomId = await createPairTeamChatroom(sessionId);

        // Don't join any participants — call updateAgentStatus directly
        await t.mutation(api.participants.updateAgentStatus, {
          sessionId,
          chatroomId,
          role: 'builder',
          agentStatus: deadState,
        });

        // Verify a minimal participant record was created
        const participant = await t.query(api.participants.getByRole, {
          sessionId,
          chatroomId,
          role: 'builder',
        });
        expect(participant).not.toBeNull();
        expect(participant!.status).toBe(deadState);
        expect(participant!.role).toBe('builder');
      });
    }
  });

  describe('non-dead-state throws PARTICIPANT_NOT_FOUND', () => {
    test('throws PARTICIPANT_NOT_FOUND for "offline" when participant does not exist', async () => {
      const { sessionId } = await createTestSession('update-status-offline-missing');
      const chatroomId = await createPairTeamChatroom(sessionId);

      try {
        await t.mutation(api.participants.updateAgentStatus, {
          sessionId,
          chatroomId,
          role: 'builder',
          agentStatus: 'offline',
        });
        expect.fail('Expected ConvexError to be thrown');
      } catch (error) {
        const data = extractErrorData(error);
        expect(data.code).toBe(BACKEND_ERROR_CODES.PARTICIPANT_NOT_FOUND);
        expect(data.message).toContain('builder');
      }
    });
  });

  describe('patches existing participant status', () => {
    test('updates existing participant to "offline"', async () => {
      const { sessionId } = await createTestSession('update-status-existing');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);

      // Update to offline
      await t.mutation(api.participants.updateAgentStatus, {
        sessionId,
        chatroomId,
        role: 'builder',
        agentStatus: 'offline',
      });

      const participant = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(participant).not.toBeNull();
      expect(participant!.status).toBe('offline');
    });

    test('updates existing participant to "dead"', async () => {
      const { sessionId } = await createTestSession('update-status-existing-dead');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);

      // Update to dead
      await t.mutation(api.participants.updateAgentStatus, {
        sessionId,
        chatroomId,
        role: 'builder',
        agentStatus: 'dead',
      });

      const participant = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(participant).not.toBeNull();
      expect(participant!.status).toBe('dead');
    });
  });
});
