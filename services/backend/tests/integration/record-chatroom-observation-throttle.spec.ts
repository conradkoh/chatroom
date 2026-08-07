/**
 * recordChatroomObservation throttle — Integration Tests
 *
 * Pins that regular heartbeats skip redundant lastObservedAt patches within
 * OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS, while refresh calls always write.
 */

import { describe, expect, test, vi, afterEach } from 'vitest';

import { OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS } from '../../config/reliability';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom } from '../helpers/integration';

async function getObservation(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_observation')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
      .first();
  });
}

describe('recordChatroomObservation throttle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('skips redundant regular heartbeat within min interval', async () => {
    const { sessionId } = await createTestSession('test-obs-throttle-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
    });

    vi.setSystemTime(t0 + OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS - 1_000);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const obs = await getObservation(chatroomId);
    expect(obs?.lastObservedAt).toBe(t0);
  });

  test('writes regular heartbeat after min interval elapses', async () => {
    const { sessionId } = await createTestSession('test-obs-throttle-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
    });

    vi.setSystemTime(t0 + OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const obs = await getObservation(chatroomId);
    expect(obs?.lastObservedAt).toBe(t0 + OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS);
  });

  test('refresh always writes even within min interval', async () => {
    const { sessionId } = await createTestSession('test-obs-throttle-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const refreshAt = t0 + 1_000;
    vi.setSystemTime(refreshAt);

    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId: sessionId as any,
      chatroomId,
      refresh: true,
    });

    const obs = await getObservation(chatroomId);
    expect(obs?.lastObservedAt).toBe(refreshAt);
    expect(obs?.lastRefreshedAt).toBe(refreshAt);
  });
});
