/**
 * Integration tests for resolveChallenge structured error codes.
 *
 * Verifies that resolveChallenge throws ConvexError<BackendError> with the
 * correct error codes for each failure mode:
 * - PARTICIPANT_NOT_FOUND (fatal) — participant doesn't exist
 * - CHALLENGE_MISMATCH (non-fatal) — wrong challengeId
 * - CHALLENGE_NOT_PENDING (non-fatal) — no pending challenge
 * - Success path — challenge resolved correctly
 */

import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';

import { BACKEND_ERROR_CODES, type BackendError } from '../../../config/errorCodes';
import { api, internal } from '../../../convex/_generated/api';
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

/**
 * Set up a chatroom with a builder participant that has a pending challenge.
 * Returns the sessionId, chatroomId, and the challengeId that was issued.
 */
async function setupPendingChallenge() {
  const { sessionId } = await createTestSession(`resolve-challenge-${Date.now()}`);
  const chatroomId = await createPairTeamChatroom(sessionId);

  const readyUntil = Date.now() + 10 * 60 * 1000;
  await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
  await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

  // Send a message, claim, start, and handoff so builder goes to 'waiting' status
  await t.mutation(api.messages.send, {
    sessionId,
    chatroomId,
    content: 'Build the feature',
    senderRole: 'user',
    type: 'message' as const,
  });
  await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
  const { taskId } = await t.mutation(api.tasks.startTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  await t.mutation(api.messages.taskStarted, {
    sessionId,
    chatroomId,
    role: 'builder',
    taskId,
    originMessageClassification: 'question',
  });
  await t.mutation(api.messages.handoff, {
    sessionId,
    chatroomId,
    senderRole: 'builder',
    content: 'Done, please review.',
    targetRole: 'reviewer',
  });

  // Issue a challenge to the builder (now in 'waiting' status)
  await t.mutation(internal.participants.issueChallenge, {});

  // Read the challengeId that was issued
  const challenge = await t.query(api.participants.getChallenge, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(challenge).not.toBeNull();
  expect(challenge!.challengeStatus).toBe('pending');

  return { sessionId, chatroomId, challengeId: challenge!.challengeId! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveChallenge error codes', () => {
  test('throws PARTICIPANT_NOT_FOUND when participant does not exist', async () => {
    const { sessionId } = await createTestSession('resolve-challenge-not-found');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Don't join any participants — just try to resolve a challenge
    try {
      await t.mutation(api.participants.resolveChallenge, {
        sessionId,
        chatroomId,
        role: 'builder',
        challengeId: 'nonexistent-challenge',
      });
      expect.fail('Expected ConvexError to be thrown');
    } catch (error) {
      const data = extractErrorData(error);
      expect(data.code).toBe(BACKEND_ERROR_CODES.PARTICIPANT_NOT_FOUND);
      expect(data.message).toContain('builder');
    }
  });

  test('throws CHALLENGE_MISMATCH when challengeId does not match', async () => {
    const { sessionId, chatroomId, challengeId } = await setupPendingChallenge();

    // Attempt to resolve with a wrong challengeId
    const wrongChallengeId = challengeId + '-wrong';
    try {
      await t.mutation(api.participants.resolveChallenge, {
        sessionId,
        chatroomId,
        role: 'builder',
        challengeId: wrongChallengeId,
      });
      expect.fail('Expected ConvexError to be thrown');
    } catch (error) {
      const data = extractErrorData(error);
      expect(data.code).toBe(BACKEND_ERROR_CODES.CHALLENGE_MISMATCH);
      expect(data.message).toContain('mismatch');
    }
  });

  test('throws CHALLENGE_NOT_PENDING when challenge is already resolved', async () => {
    const { sessionId, chatroomId, challengeId } = await setupPendingChallenge();

    // Resolve the challenge successfully first
    await t.mutation(api.participants.resolveChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
      challengeId,
    });

    // Attempt to resolve the same challenge again — it's no longer pending
    try {
      await t.mutation(api.participants.resolveChallenge, {
        sessionId,
        chatroomId,
        role: 'builder',
        challengeId,
      });
      expect.fail('Expected ConvexError to be thrown');
    } catch (error) {
      const data = extractErrorData(error);
      expect(data.code).toBe(BACKEND_ERROR_CODES.CHALLENGE_NOT_PENDING);
      expect(data.message).toContain('pending');
    }
  });

  test('successfully resolves a valid pending challenge', async () => {
    const { sessionId, chatroomId, challengeId } = await setupPendingChallenge();

    // Should not throw
    await t.mutation(api.participants.resolveChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
      challengeId,
    });

    // Verify challenge status is now 'resolved'
    const challenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(challenge).not.toBeNull();
    expect(challenge!.challengeStatus).toBe('resolved');
  });
});
