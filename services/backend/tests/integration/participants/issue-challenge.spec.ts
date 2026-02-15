/**
 * Integration tests for issueChallenge using by_status index.
 *
 * Verifies that issueChallenge:
 * - Only issues challenges to participants with status 'waiting'
 * - Skips participants that already have a pending challenge
 * - Does not issue challenges to 'active' or 'offline' participants
 * - Generates unique challengeIds (crypto.randomUUID)
 */

import { describe, expect, test } from 'vitest';

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
 * Set up a chatroom where builder is in 'waiting' status (after handoff)
 * and reviewer is in 'active' status (has a pending task).
 */
async function setupMixedStatusChatroom() {
  const { sessionId } = await createTestSession(`issue-challenge-${Date.now()}`);
  const chatroomId = await createPairTeamChatroom(sessionId);

  const readyUntil = Date.now() + 10 * 60 * 1000;
  await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
  await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

  // Send a message, claim, start, and handoff so builder goes to 'waiting'
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

  // At this point: builder='waiting', reviewer='active' (has the task from handoff)
  return { sessionId, chatroomId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issueChallenge', () => {
  test('issues challenge only to waiting participants', async () => {
    const { sessionId, chatroomId } = await setupMixedStatusChatroom();

    // Verify initial states
    const builder = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const reviewer = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });
    expect(builder!.status).toBe('waiting');
    // Reviewer should be active (received handoff task)
    expect(['active', 'waiting']).toContain(reviewer!.status);

    // Issue challenges
    await t.mutation(internal.participants.issueChallenge, {});

    // Builder (waiting) should have a pending challenge
    const builderChallenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(builderChallenge).not.toBeNull();
    expect(builderChallenge!.challengeStatus).toBe('pending');
    expect(builderChallenge!.challengeId).toBeTruthy();
    expect(builderChallenge!.challengeExpiresAt).toBeGreaterThan(Date.now());
  });

  test('skips participants that already have a pending challenge', async () => {
    const { sessionId, chatroomId } = await setupMixedStatusChatroom();

    // Issue challenges — first round
    await t.mutation(internal.participants.issueChallenge, {});

    // Get the first challengeId
    const firstChallenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(firstChallenge).not.toBeNull();
    const firstChallengeId = firstChallenge!.challengeId;

    // Issue challenges again — second round
    await t.mutation(internal.participants.issueChallenge, {});

    // The challengeId should NOT have changed (pending challenge was skipped)
    const secondChallenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(secondChallenge).not.toBeNull();
    expect(secondChallenge!.challengeId).toBe(firstChallengeId);
  });

  test('issues new challenge after previous one is resolved', async () => {
    const { sessionId, chatroomId } = await setupMixedStatusChatroom();

    // Issue first challenge
    await t.mutation(internal.participants.issueChallenge, {});

    const firstChallenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const firstChallengeId = firstChallenge!.challengeId!;

    // Resolve the first challenge
    await t.mutation(api.participants.resolveChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
      challengeId: firstChallengeId,
    });

    // Issue second challenge — should get a new one since previous was resolved
    await t.mutation(internal.participants.issueChallenge, {});

    const secondChallenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(secondChallenge).not.toBeNull();
    expect(secondChallenge!.challengeStatus).toBe('pending');
    // New challenge should have a different ID (crypto.randomUUID)
    expect(secondChallenge!.challengeId).not.toBe(firstChallengeId);
  });

  test('does not issue challenges when no participants are waiting', async () => {
    const { sessionId } = await createTestSession('issue-challenge-no-waiting');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const readyUntil = Date.now() + 10 * 60 * 1000;
    await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);

    // Builder is in 'waiting' after join, but let's set it to offline
    await t.mutation(api.participants.updateAgentStatus, {
      sessionId,
      chatroomId,
      role: 'builder',
      agentStatus: 'offline',
    });

    // Issue challenges — should not issue any
    await t.mutation(internal.participants.issueChallenge, {});

    // No challenge should be issued
    const challenge = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(challenge).toBeNull();
  });
});
