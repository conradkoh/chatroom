/**
 * Tests for standing instructions — title field.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

describe('standing instructions title', () => {
  test('get returns title as empty string when field absent', async () => {
    const { sessionId } = await createTestSession('si-title-absent');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.title).toBe('');
  });

  test('upsert with title stores trimmed title', async () => {
    const { sessionId } = await createTestSession('si-title-trim');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'always be coding',
      title: '  My Rule  ',
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.title).toBe('My Rule');
  });

  test('upsert without title throws TITLE_REQUIRED', async () => {
    const { sessionId } = await createTestSession('si-title-required');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.standingInstructions.upsert, {
        sessionId,
        chatroomId,
        content: 'some rule',
        title: '',
      })
    ).rejects.toThrow(/TITLE_REQUIRED/i);
  });

  test('upsert with long title throws TITLE_TOO_LONG', async () => {
    const { sessionId } = await createTestSession('si-title-long');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.standingInstructions.upsert, {
        sessionId,
        chatroomId,
        content: 'test',
        title: 'x'.repeat(121),
      })
    ).rejects.toThrow(/TITLE_TOO_LONG/i);
  });

  test('clear removes title along with content', async () => {
    const { sessionId } = await createTestSession('si-title-clear-all');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'test content',
      title: 'My Rule',
    });

    await t.mutation(api.standingInstructions.clear, {
      sessionId,
      chatroomId,
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.content).toBe('');
    expect(result.title).toBe('');
    expect(result.enabled).toBe(false);
  });

  test('listHistory returns title', async () => {
    const { sessionId } = await createTestSession('si-title-history');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Always use TypeScript',
      title: 'Type safety',
    });

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });

    expect(history).toHaveLength(1);
    expect(history[0]!.content).toBe('Always use TypeScript');
    expect(history[0]!.title).toBe('Type safety');
  });

  test('recordUse returns title', async () => {
    const { sessionId } = await createTestSession('si-title-record-use');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Write unit tests first',
      title: 'Tests first',
    });

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });

    const result = await t.mutation(api.standingInstructions.recordUse, {
      sessionId,
      historyId: history[0]!._id,
    });

    expect(result.content).toBe('Write unit tests first');
    expect(result.title).toBe('Tests first');
  });
});

describe('standing instructions presets', () => {
  const CONTENT = 'Always use TypeScript';
  const TITLE = 'Type safety';

  async function setupTwoLinkedRooms(sessionId: SessionId) {
    const roomA = await createChatroom(sessionId);
    const roomB = await createChatroom(sessionId);

    // Same content+title on both rooms links them to the same preset
    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId: roomA,
      content: CONTENT,
      title: TITLE,
    });
    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId: roomB,
      content: CONTENT,
      title: TITLE,
    });

    return { roomA, roomB };
  }

  test('get returns presetId when linked', async () => {
    const { sessionId } = await createTestSession('si-preset-get');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: CONTENT,
      title: TITLE,
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.presetId).toBeDefined();
    expect(result.content).toBe(CONTENT);
    expect(result.title).toBe(TITLE);
  });

  test('updatePreset changes get results on all linked rooms', async () => {
    const { sessionId } = await createTestSession('si-preset-update');
    const { roomA, roomB } = await setupTwoLinkedRooms(sessionId);

    const beforeA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });
    const beforeB = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomB,
    });
    expect(beforeA.presetId).toBe(beforeB.presetId);
    expect(beforeA.content).toBe(CONTENT);

    await t.mutation(api.standingInstructions.updatePreset, {
      sessionId,
      presetId: beforeA.presetId,
      content: 'Use strict mode everywhere',
      title: 'Strict mode',
    });

    const afterA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });
    const afterB = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomB,
    });

    expect(afterA.content).toBe('Use strict mode everywhere');
    expect(afterA.title).toBe('Strict mode');
    expect(afterB.content).toBe('Use strict mode everywhere');
    expect(afterB.title).toBe('Strict mode');
  });

  test('getPresetUsage returns active/inactive breakdown', async () => {
    const { sessionId } = await createTestSession('si-preset-usage');
    const { roomA, roomB } = await setupTwoLinkedRooms(sessionId);

    // Disable one room → inactive
    await t.mutation(api.standingInstructions.setEnabled, {
      sessionId,
      chatroomId: roomB,
      enabled: false,
    });

    const getA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });
    const usage = await t.query(api.standingInstructions.getPresetUsage, {
      sessionId,
      presetId: getA.presetId,
    });

    expect(usage.totalCount).toBe(2);
    expect(usage.activeCount).toBe(1);
    expect(usage.inactiveCount).toBe(1);
    const activeRoom = usage.usages.find((u) => u.chatroomId === roomA);
    const inactiveRoom = usage.usages.find((u) => u.chatroomId === roomB);
    expect(activeRoom?.enabled).toBe(true);
    expect(inactiveRoom?.enabled).toBe(false);
  });

  test('deletePreset removes preset and unlinks all linked rooms', async () => {
    const { sessionId } = await createTestSession('si-preset-delete');
    const { roomA, roomB } = await setupTwoLinkedRooms(sessionId);

    const getA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });

    await t.mutation(api.standingInstructions.deletePreset, {
      sessionId,
      presetId: getA.presetId,
    });

    const afterA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });
    const afterB = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomB,
    });
    expect(afterA.content).toBe('');
    expect(afterA.presetId).toBeUndefined();
    expect(afterB.content).toBe('');
    expect(afterB.presetId).toBeUndefined();

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });
    expect(history).toHaveLength(0);
  });

  test('clear on one room does not affect other rooms or the preset library', async () => {
    const { sessionId } = await createTestSession('si-preset-clear');
    const { roomA, roomB } = await setupTwoLinkedRooms(sessionId);

    await t.mutation(api.standingInstructions.clear, {
      sessionId,
      chatroomId: roomA,
    });

    const afterA = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomA,
    });
    const afterB = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId: roomB,
    });

    expect(afterA.content).toBe('');
    expect(afterA.presetId).toBeUndefined();
    // Room B untouched and still linked
    expect(afterB.content).toBe(CONTENT);
    expect(afterB.presetId).toBeDefined();

    // Preset library entry survives
    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });
    expect(history).toHaveLength(1);
  });
});
