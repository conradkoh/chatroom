/**
 * Features System Integration Tests
 *
 * Tests for feature metadata storage and retrieval.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

/**
 * Helper to create a test session and authenticate
 */
async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Helper to create a Pair team chatroom
 */
async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
  return chatroomId;
}

/**
 * Helper to join participants to the chatroom with ready status
 */
async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  const readyUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      readyUntil,
    });
  }
}

describe('Features System', () => {
  describe('taskStarted with feature metadata', () => {
    test('stores feature metadata when classification is new_feature', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-feature-metadata');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends a message
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add dark mode support to the app',
        type: 'message',
      });

      // Builder starts task and classifies with feature metadata
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'new_feature',
        featureTitle: 'Dark Mode Support',
        featureDescription: 'Add a toggle to switch between light and dark themes',
        featureTechSpecs: 'Use CSS custom properties for theming, store preference in localStorage',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('new_feature');
    });

    test('does not require feature metadata for question classification', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-question-no-metadata');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends a question
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'How do I run the tests?',
        type: 'message',
      });

      // Builder starts task and classifies as question (no metadata needed)
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'question',
        // No feature metadata
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('question');
    });
  });

  describe('listFeatures query', () => {
    test('returns features with metadata ordered by creation time', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-list-features');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create first feature
      const msg1 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'First feature request',
        type: 'message',
      });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: msg1,
        classification: 'new_feature',
        featureTitle: 'Feature One',
        featureDescription: 'Description of feature one',
        featureTechSpecs: 'Tech specs for feature one',
      });

      // Complete first task via reviewer (new_feature must go through reviewer)
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature one, please review',
        targetRole: 'reviewer',
      });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'reviewer' });
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'Approved feature one',
        targetRole: 'user',
      });

      // Create second feature
      const msg2 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Second feature request',
        type: 'message',
      });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: msg2,
        classification: 'new_feature',
        featureTitle: 'Feature Two',
        featureDescription:
          'Description of feature two that is longer than 100 characters so we can verify truncation works correctly in the preview text',
        featureTechSpecs: 'Tech specs for feature two',
      });

      // List features
      const features = await t.query(api.messages.listFeatures, {
        sessionId,
        chatroomId,
        limit: 10,
      });

      // Should have 2 features, most recent first
      expect(features).toHaveLength(2);
      expect(features[0].title).toBe('Feature Two');
      expect(features[1].title).toBe('Feature One');

      // Verify description preview truncation
      expect(features[0].descriptionPreview).toContain('...');
      expect(features[0].descriptionPreview!.length).toBeLessThanOrEqual(103); // 100 chars + "..."
    });

    test('returns empty array when no features exist', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-no-features');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // List features (none exist)
      const features = await t.query(api.messages.listFeatures, {
        sessionId,
        chatroomId,
        limit: 10,
      });

      expect(features).toHaveLength(0);
    });
  });

  describe('inspectFeature query', () => {
    test('returns full feature details with conversation thread', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-inspect-feature');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create feature
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add user authentication',
        type: 'message',
      });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'new_feature',
        featureTitle: 'User Authentication',
        featureDescription: 'Add login/logout functionality',
        featureTechSpecs: 'Use JWT tokens, store in httpOnly cookies',
      });

      // Add some conversation (handoff to reviewer)
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Implemented auth, please review',
        targetRole: 'reviewer',
      });

      // Reviewer responds
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'reviewer' });
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'Looks good, approved!',
        targetRole: 'user',
      });

      // Inspect feature
      const result = await t.query(api.messages.inspectFeature, {
        sessionId,
        chatroomId,
        messageId: userMessageId,
      });

      // Verify feature details
      expect(result.feature.title).toBe('User Authentication');
      expect(result.feature.description).toBe('Add login/logout functionality');
      expect(result.feature.techSpecs).toBe('Use JWT tokens, store in httpOnly cookies');
      expect(result.feature.content).toBe('Add user authentication');

      // Verify thread has the conversation
      expect(result.thread.length).toBeGreaterThanOrEqual(2);
      expect(result.thread.some((m) => m.senderRole === 'builder')).toBe(true);
      expect(result.thread.some((m) => m.senderRole === 'reviewer')).toBe(true);
    });

    test('throws error for non-feature message', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-inspect-non-feature');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a question (not a feature)
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'How do I run tests?',
        type: 'message',
      });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'question',
      });

      // Try to inspect as feature - should fail
      await expect(
        t.query(api.messages.inspectFeature, {
          sessionId,
          chatroomId,
          messageId: userMessageId,
        })
      ).rejects.toThrow('Message is not a feature');
    });
  });
});
