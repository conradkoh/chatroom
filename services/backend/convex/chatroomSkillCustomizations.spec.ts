/**
 * Tests for chatroomSkillCustomizations CRUD operations and auth-gap regression.
 *
 * The "throws on cross-chatroom" tests are regression guards for the fix that
 * ensures mutation handlers verify a customization belongs to the caller's
 * chatroom before operating on it.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE } from '../src/domain/types/skills';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEVELOPMENT_WORKFLOW_TYPE = DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE;

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function createCustomization(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content = 'Default workflow content',
  name = 'My Workflow'
): Promise<Id<'chatroom_skillCustomizations'>> {
  return await t.mutation(api.chatroomSkillCustomizations.create, {
    sessionId,
    chatroomId,
    type: DEVELOPMENT_WORKFLOW_TYPE,
    name,
    content,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chatroomSkillCustomizations.create', () => {
  test('returns an ID and persists the document with correct fields', async () => {
    const { sessionId, userId } = await createTestSession('csc-create-1');
    const chatroomId = await createChatroom(sessionId);

    const content = 'My custom development workflow steps.';
    const name = 'My Workflow';

    const id = await t.mutation(api.chatroomSkillCustomizations.create, {
      sessionId,
      chatroomId,
      type: DEVELOPMENT_WORKFLOW_TYPE,
      name,
      content,
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    // Verify persisted document fields
    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc).not.toBeNull();
    expect(doc?.chatroomId).toBe(chatroomId);
    expect(doc?.ownerId).toBe(userId);
    expect(doc?.type).toBe(DEVELOPMENT_WORKFLOW_TYPE);
    expect(doc?.name).toBe(name);
    expect(doc?.content).toBe(content);
    expect(doc?.isEnabled).toBe(true);
    expect(typeof doc?.createdAt).toBe('number');
    expect(typeof doc?.updatedAt).toBe('number');
  });
});

describe('chatroomSkillCustomizations.update', () => {
  test('patches content and updatedAt', async () => {
    const { sessionId } = await createTestSession('csc-update-1');
    const chatroomId = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomId, 'original content');

    const originalDoc = await t.run(async (ctx) => ctx.db.get(customizationId));
    const originalUpdatedAt = originalDoc?.updatedAt;

    // Small delay to ensure updatedAt changes
    await new Promise((r) => setTimeout(r, 5));

    await t.mutation(api.chatroomSkillCustomizations.update, {
      sessionId,
      chatroomId,
      customizationId,
      content: 'updated content',
    });

    const updatedDoc = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(updatedDoc?.content).toBe('updated content');
    expect(updatedDoc?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt!);
  });

  test('throws ConvexError when customization belongs to a different chatroom (auth gap regression)', async () => {
    const { sessionId } = await createTestSession('csc-update-xroom-1');

    // chatroomA owns the customization
    const chatroomA = await createChatroom(sessionId);
    // chatroomB is a different chatroom the same session has access to
    const chatroomB = await createChatroom(sessionId);

    const customizationId = await createCustomization(sessionId, chatroomA, 'content in A');

    // Try to update via chatroomB — should be rejected even though session owns both
    await expect(
      t.mutation(api.chatroomSkillCustomizations.update, {
        sessionId,
        chatroomId: chatroomB,
        customizationId,
        content: 'malicious update',
      })
    ).rejects.toThrow(ConvexError);

    // Original content must remain unchanged
    const doc = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(doc?.content).toBe('content in A');
  });
});

describe('chatroomSkillCustomizations.remove', () => {
  test('deletes the customization document', async () => {
    const { sessionId } = await createTestSession('csc-remove-1');
    const chatroomId = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomId);

    await t.mutation(api.chatroomSkillCustomizations.remove, {
      sessionId,
      chatroomId,
      customizationId,
    });

    const doc = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(doc).toBeNull();
  });

  test('throws ConvexError when customization belongs to a different chatroom (auth gap regression)', async () => {
    const { sessionId } = await createTestSession('csc-remove-xroom-1');

    const chatroomA = await createChatroom(sessionId);
    const chatroomB = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomA);

    // Attempt to delete via chatroomB
    await expect(
      t.mutation(api.chatroomSkillCustomizations.remove, {
        sessionId,
        chatroomId: chatroomB,
        customizationId,
      })
    ).rejects.toThrow(ConvexError);

    // Document must still exist
    const doc = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(doc).not.toBeNull();
  });
});

describe('chatroomSkillCustomizations.toggle', () => {
  test('flips isEnabled from true to false and back', async () => {
    const { sessionId } = await createTestSession('csc-toggle-1');
    const chatroomId = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomId);

    // Initially enabled
    const before = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(before?.isEnabled).toBe(true);

    // Toggle off
    await t.mutation(api.chatroomSkillCustomizations.toggle, {
      sessionId,
      chatroomId,
      customizationId,
    });

    const afterToggle = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(afterToggle?.isEnabled).toBe(false);

    // Toggle back on
    await t.mutation(api.chatroomSkillCustomizations.toggle, {
      sessionId,
      chatroomId,
      customizationId,
    });

    const afterSecondToggle = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(afterSecondToggle?.isEnabled).toBe(true);
  });

  test('throws ConvexError on cross-chatroom access (auth gap regression)', async () => {
    const { sessionId } = await createTestSession('csc-toggle-xroom-1');

    const chatroomA = await createChatroom(sessionId);
    const chatroomB = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomA);

    await expect(
      t.mutation(api.chatroomSkillCustomizations.toggle, {
        sessionId,
        chatroomId: chatroomB,
        customizationId,
      })
    ).rejects.toThrow(ConvexError);

    // isEnabled must remain unchanged
    const doc = await t.run(async (ctx) => ctx.db.get(customizationId));
    expect(doc?.isEnabled).toBe(true);
  });
});

describe('chatroomSkillCustomizations.copyTo', () => {
  test('creates copies of the customization in target chatrooms', async () => {
    const { sessionId } = await createTestSession('csc-copyto-1');

    const sourceChatroomId = await createChatroom(sessionId);
    const targetChatroomA = await createChatroom(sessionId);
    const targetChatroomB = await createChatroom(sessionId);

    const sourceContent = 'Workflow to copy';
    const sourceName = 'Source Workflow';
    const sourceCustomizationId = await createCustomization(
      sessionId,
      sourceChatroomId,
      sourceContent,
      sourceName
    );

    const createdIds = await t.mutation(api.chatroomSkillCustomizations.copyTo, {
      sessionId,
      chatroomId: sourceChatroomId,
      sourceCustomizationId,
      targetChatroomIds: [targetChatroomA, targetChatroomB],
    });

    expect(createdIds).toHaveLength(2);

    // Verify each copy
    for (const [idx, copiedId] of createdIds.entries()) {
      const copy = await t.run(async (ctx) => ctx.db.get(copiedId));
      expect(copy).not.toBeNull();
      expect(copy?.content).toBe(sourceContent);
      expect(copy?.name).toBe(sourceName);
      expect(copy?.sourceChatroomId).toBe(sourceChatroomId);
      expect(copy?.sourceCustomizationId).toBe(sourceCustomizationId);
      expect(copy?.chatroomId).toBe(idx === 0 ? targetChatroomA : targetChatroomB);
    }
  });

  test('throws when user lacks access to a target chatroom', async () => {
    const { sessionId: sessionA } = await createTestSession('csc-copyto-noaccess-a');
    const { sessionId: sessionB } = await createTestSession('csc-copyto-noaccess-b');

    const sourceChatroomId = await createChatroom(sessionA);
    // chatroomB is owned by sessionB — sessionA has no access
    const foreignChatroomId = await createChatroom(sessionB);

    const sourceCustomizationId = await createCustomization(
      sessionA,
      sourceChatroomId,
      'content'
    );

    await expect(
      t.mutation(api.chatroomSkillCustomizations.copyTo, {
        sessionId: sessionA,
        chatroomId: sourceChatroomId,
        sourceCustomizationId,
        targetChatroomIds: [foreignChatroomId],
      })
    ).rejects.toThrow();
  });
});

describe('chatroomSkillCustomizations.bulkUpdate', () => {
  test('patches content on all target customizations', async () => {
    const { sessionId } = await createTestSession('csc-bulkupdate-1');
    const chatroomId = await createChatroom(sessionId);

    const idA = await createCustomization(sessionId, chatroomId, 'old content A', 'Workflow A');
    const idB = await createCustomization(sessionId, chatroomId, 'old content B', 'Workflow B');
    const sourceCustomizationId = await createCustomization(sessionId, chatroomId, 'source');

    const newContent = 'bulk updated content';

    await t.mutation(api.chatroomSkillCustomizations.bulkUpdate, {
      sessionId,
      chatroomId,
      sourceCustomizationId,
      targetCustomizationIds: [idA, idB],
      content: newContent,
    });

    const docA = await t.run(async (ctx) => ctx.db.get(idA));
    const docB = await t.run(async (ctx) => ctx.db.get(idB));

    expect(docA?.content).toBe(newContent);
    expect(docB?.content).toBe(newContent);
  });

  test('throws ConvexError if any target customization belongs to a different chatroom (auth gap regression)', async () => {
    const { sessionId } = await createTestSession('csc-bulkupdate-xroom-1');

    const chatroomA = await createChatroom(sessionId);
    const chatroomB = await createChatroom(sessionId);

    const idInA = await createCustomization(sessionId, chatroomA, 'content in A');
    // idInB belongs to chatroomB — should be rejected when called with chatroomA
    const idInB = await createCustomization(sessionId, chatroomB, 'content in B');
    const sourceId = await createCustomization(sessionId, chatroomA, 'source');

    await expect(
      t.mutation(api.chatroomSkillCustomizations.bulkUpdate, {
        sessionId,
        chatroomId: chatroomA,
        sourceCustomizationId: sourceId,
        targetCustomizationIds: [idInA, idInB],
        content: 'attempted bulk update',
      })
    ).rejects.toThrow(ConvexError);

    // Neither document should have been modified
    const docA = await t.run(async (ctx) => ctx.db.get(idInA));
    const docB = await t.run(async (ctx) => ctx.db.get(idInB));
    expect(docA?.content).toBe('content in A');
    expect(docB?.content).toBe('content in B');
  });
});

describe('chatroomSkillCustomizations.getForChatroom', () => {
  test('returns the customization for the matching type', async () => {
    const { sessionId } = await createTestSession('csc-get-1');
    const chatroomId = await createChatroom(sessionId);

    const content = 'Specific workflow content';
    const customizationId = await createCustomization(sessionId, chatroomId, content);

    const result = await t.query(api.chatroomSkillCustomizations.getForChatroom, {
      sessionId,
      chatroomId,
      type: DEVELOPMENT_WORKFLOW_TYPE,
    });

    expect(result).not.toBeNull();
    expect(result?._id).toBe(customizationId);
    expect(result?.content).toBe(content);
    expect(result?.chatroomId).toBe(chatroomId);
  });

  test('returns null when no customization exists for the type', async () => {
    const { sessionId } = await createTestSession('csc-get-null-1');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.chatroomSkillCustomizations.getForChatroom, {
      sessionId,
      chatroomId,
      type: DEVELOPMENT_WORKFLOW_TYPE,
    });

    expect(result).toBeNull();
  });
});

describe('chatroomSkillCustomizations.findCopies', () => {
  test('returns documents pointing to the source via sourceCustomizationId', async () => {
    const { sessionId } = await createTestSession('csc-findcopies-1');

    const sourceChatroomId = await createChatroom(sessionId);
    const targetChatroomA = await createChatroom(sessionId);
    const targetChatroomB = await createChatroom(sessionId);

    const sourceCustomizationId = await createCustomization(
      sessionId,
      sourceChatroomId,
      'source content'
    );

    // Copy to two chatrooms
    const createdIds = await t.mutation(api.chatroomSkillCustomizations.copyTo, {
      sessionId,
      chatroomId: sourceChatroomId,
      sourceCustomizationId,
      targetChatroomIds: [targetChatroomA, targetChatroomB],
    });

    // findCopies from the source chatroom
    const copies = await t.query(api.chatroomSkillCustomizations.findCopies, {
      sessionId,
      chatroomId: sourceChatroomId,
      customizationId: sourceCustomizationId,
    });

    expect(copies).toHaveLength(2);
    const copyIds = copies.map((c) => c._id);
    expect(copyIds).toContain(createdIds[0]);
    expect(copyIds).toContain(createdIds[1]);

    // All copies must reference the source
    for (const copy of copies) {
      expect(copy.sourceCustomizationId).toBe(sourceCustomizationId);
    }
  });

  test('returns empty array when no copies exist', async () => {
    const { sessionId } = await createTestSession('csc-findcopies-empty-1');
    const chatroomId = await createChatroom(sessionId);
    const customizationId = await createCustomization(sessionId, chatroomId);

    const copies = await t.query(api.chatroomSkillCustomizations.findCopies, {
      sessionId,
      chatroomId,
      customizationId,
    });

    expect(copies).toHaveLength(0);
  });
});
