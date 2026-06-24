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

async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

async function createBuilderEntryDuoChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
  return chatroomId;
}

async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
    });
  }
}

async function setMessageClassification(
  messageId: Id<'chatroom_messages'>,
  classification: 'question' | 'new_feature' | 'follow_up',
  feature?: { title: string; description: string; techSpecs: string }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_messages', messageId, {
      classification,
      ...(feature && {
        featureTitle: feature.title,
        featureDescription: feature.description,
        featureTechSpecs: feature.techSpecs,
      }),
    });
  });
}

describe('Features System', () => {
  describe('listFeatures query', () => {
    test('returns features with metadata ordered by creation time', async () => {
      const { sessionId } = await createTestSession('test-list-features');
      const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'First feature request',
        type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const start1 = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const task1 = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', start1.taskId));
      expect(task1?.sourceMessageId).toBeDefined();
      await setMessageClassification(task1!.sourceMessageId!, 'new_feature', {
        title: 'Feature One',
        description: 'Description of feature one',
        techSpecs: 'Tech specs for feature one',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature one, ready for delivery',
        targetRole: 'planner',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'planner' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'planner' });
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Approved feature one',
        targetRole: 'user',
      });

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Second feature request',
        type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const start2 = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const task2 = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', start2.taskId));
      expect(task2?.sourceMessageId).toBeDefined();
      await setMessageClassification(task2!.sourceMessageId!, 'new_feature', {
        title: 'Feature Two',
        description:
          'Description of feature two that is longer than 100 characters so we can verify truncation works correctly in the preview text',
        techSpecs: 'Tech specs for feature two',
      });

      const features = await t.query(api.messages.listFeatures, {
        sessionId,
        chatroomId,
        limit: 10,
      });

      expect(features).toHaveLength(2);
      expect(features[0].title).toBe('Feature Two');
      expect(features[1].title).toBe('Feature One');
      expect(features[0].descriptionPreview).toContain('...');
      expect(features[0].descriptionPreview!.length).toBeLessThanOrEqual(103);
    });

    test('returns empty array when no features exist', async () => {
      const { sessionId } = await createTestSession('test-no-features');
      const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
      const { sessionId } = await createTestSession('test-inspect-feature');
      const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add user authentication',
        type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', startResult.taskId));
      const userMessageId = task!.sourceMessageId!;
      await setMessageClassification(userMessageId, 'new_feature', {
        title: 'User Authentication',
        description: 'Add login/logout functionality',
        techSpecs: 'Use JWT tokens, store in httpOnly cookies',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Implemented auth, please review',
        targetRole: 'planner',
      });

      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'planner' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'planner' });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Looks good, approved!',
        targetRole: 'user',
      });

      const result = await t.query(api.messages.inspectFeature, {
        sessionId,
        chatroomId,
        messageId: userMessageId,
      });

      expect(result.feature.title).toBe('User Authentication');
      expect(result.feature.description).toBe('Add login/logout functionality');
      expect(result.feature.techSpecs).toBe('Use JWT tokens, store in httpOnly cookies');
      expect(result.feature.content).toBe('Add user authentication');
      expect(result.thread.length).toBeGreaterThanOrEqual(2);
      expect(result.thread.some((m) => m.senderRole === 'builder')).toBe(true);
      expect(result.thread.some((m) => m.senderRole === 'planner')).toBe(true);
    });

    test('throws error for non-feature message', async () => {
      const { sessionId } = await createTestSession('test-inspect-non-feature');
      const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'How do I run tests?',
        type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', startResult.taskId));
      await setMessageClassification(task!.sourceMessageId!, 'question');

      await expect(
        t.query(api.messages.inspectFeature, {
          sessionId,
          chatroomId,
          messageId: task!.sourceMessageId!,
        })
      ).rejects.toThrow('Message is not a feature');
    });
  });
});
