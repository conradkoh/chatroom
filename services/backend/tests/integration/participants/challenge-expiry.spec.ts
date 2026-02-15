/**
 * Integration tests for challenge expiry in cleanupStaleAgents.
 *
 * Verifies that cleanupStaleAgents correctly handles expired challenges:
 * - Custom agents: deleted when challenge expires
 * - Remote agents: marked 'dead' (for daemon revive) when challenge expires
 * - Non-expired challenges: left untouched
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../../convex/_generated/api';
import { t } from '../../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up a chatroom with a waiting builder that has a pending challenge,
 * then manually expire the challenge by backdating challengeExpiresAt.
 */
async function setupExpiredChallenge(
  opts: { agentType?: 'custom' | 'remote'; machineId?: string } = {}
) {
  const { sessionId } = await createTestSession(`challenge-expiry-${Date.now()}`);
  const chatroomId = await createPairTeamChatroom(sessionId);

  // If remote, register machine and set up agent config first
  if (opts.agentType === 'remote' && opts.machineId) {
    await registerMachineWithDaemon(sessionId, opts.machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, opts.machineId, 'builder');
  }

  const readyUntil = Date.now() + 10 * 60 * 1000;
  // Join builder with agentType if specified (needed for remote agent tests)
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role: 'builder',
    readyUntil,
    ...(opts.agentType ? { agentType: opts.agentType } : {}),
  });
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

  // Issue a challenge
  await t.mutation(internal.participants.issueChallenge, {});

  // Verify challenge was issued
  const challenge = await t.query(api.participants.getChallenge, {
    sessionId,
    chatroomId,
    role: 'builder',
  });
  expect(challenge).not.toBeNull();
  expect(challenge!.challengeStatus).toBe('pending');

  // Manually expire the challenge by backdating challengeExpiresAt
  await t.run(async (ctx) => {
    const participants = await ctx.db
      .query('chatroom_participants')
      .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
      .collect();
    const builder = participants.find((p) => p.role === 'builder');
    if (builder) {
      await ctx.db.patch('chatroom_participants', builder._id, {
        challengeExpiresAt: Date.now() - 10_000, // expired 10 seconds ago
      });
    }
  });

  return { sessionId, chatroomId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('challenge expiry in cleanupStaleAgents', () => {
  test('custom agent is deleted when challenge expires', async () => {
    const { sessionId, chatroomId } = await setupExpiredChallenge();

    // Verify builder exists before cleanup
    const before = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(before).not.toBeNull();

    // Run cleanup
    await t.mutation(internal.tasks.cleanupStaleAgents, {});

    // Builder should be deleted (custom agent with expired challenge)
    const after = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(after).toBeNull();
  });

  test('remote agent is marked dead (not deleted) when challenge expires', async () => {
    const machineId = `machine-challenge-expiry-${Date.now()}`;
    const { sessionId, chatroomId } = await setupExpiredChallenge({
      agentType: 'remote',
      machineId,
    });

    // Verify builder exists before cleanup
    const before = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(before).not.toBeNull();

    // Run cleanup
    await t.mutation(internal.tasks.cleanupStaleAgents, {});

    // Builder should still exist but with status 'dead' (for daemon revive)
    const after = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(after).not.toBeNull();
    expect(after!.status).toBe('dead');
    // Challenge fields should be cleared
    expect(after!.challengeStatus).toBeUndefined();
    expect(after!.challengeId).toBeUndefined();
  });

  test('non-expired challenge is left untouched by cleanup', async () => {
    const { sessionId } = await createTestSession(`challenge-not-expired-${Date.now()}`);
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

    // Issue a challenge (NOT expired — default timeout is far in the future)
    await t.mutation(internal.participants.issueChallenge, {});

    const challengeBefore = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(challengeBefore).not.toBeNull();
    expect(challengeBefore!.challengeStatus).toBe('pending');
    const originalChallengeId = challengeBefore!.challengeId;

    // Run cleanup — should NOT affect the non-expired challenge
    await t.mutation(internal.tasks.cleanupStaleAgents, {});

    // Builder should still exist with the same pending challenge
    const after = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(after).not.toBeNull();

    const challengeAfter = await t.query(api.participants.getChallenge, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(challengeAfter).not.toBeNull();
    expect(challengeAfter!.challengeStatus).toBe('pending');
    expect(challengeAfter!.challengeId).toBe(originalChallengeId);
  });
});
