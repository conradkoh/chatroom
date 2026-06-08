/**
 * Recently-Observed Workspaces Scoping — Integration Tests
 *
 * `listRecentlyObservedWorkspacesForMachine` returns the machine's active
 * workspaces whose chatroom has been observed within the recency window.
 *
 * These tests pin the behaviour that observation lookups are scoped to the
 * machine's own chatrooms (point lookups on `by_chatroomId`), independent of
 * how many other recently-observed chatrooms exist globally:
 *
 * 1. Only workspaces whose chatroom was observed within the window are returned
 * 2. A chatroom with no observation row is excluded
 * 3. Recently-observed chatrooms belonging to OTHER machines do not leak in
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

const RECENCY_WINDOW_MS = 60_000;

async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as any,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

/** Directly set the observation timestamp for a chatroom (deterministic). */
async function setObservedAt(chatroomId: Id<'chatroom_rooms'>, lastObservedAt: number) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('chatroom_observation')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
      .first();
    if (existing) {
      await ctx.db.patch('chatroom_observation', existing._id, { lastObservedAt });
    } else {
      await ctx.db.insert('chatroom_observation', { chatroomId, lastObservedAt });
    }
  });
}

async function listForMachine(sessionId: string, machineId: string) {
  return t.query(api.workspaces.listRecentlyObservedWorkspacesForMachine, {
    sessionId: sessionId as any,
    machineId,
    recencyWindowMs: RECENCY_WINDOW_MS,
  });
}

describe('recently-observed workspaces scoping', () => {
  test('returns only workspaces whose chatroom was observed within the window', async () => {
    const { sessionId: sid } = await createTestSession('test-rows-1');
    const machineId = 'machine-rows-1';
    await registerMachineWithDaemon(sid, machineId);

    const recentRoom = await createDuoTeamChatroom(sid);
    const staleRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, recentRoom, machineId, '/ws/recent');
    await registerWorkspace(sid, staleRoom, machineId, '/ws/stale');

    const now = Date.now();
    await setObservedAt(recentRoom, now);
    await setObservedAt(staleRoom, now - 2 * RECENCY_WINDOW_MS);

    const result = await listForMachine(sid, machineId);
    const chatroomIds = result.map((w) => w.chatroomId);

    expect(chatroomIds).toContain(recentRoom);
    expect(chatroomIds).not.toContain(staleRoom);
  });

  test('excludes a chatroom that has no observation row', async () => {
    const { sessionId: sid } = await createTestSession('test-rows-2');
    const machineId = 'machine-rows-2';
    await registerMachineWithDaemon(sid, machineId);

    const observedRoom = await createDuoTeamChatroom(sid);
    const unobservedRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, observedRoom, machineId, '/ws/observed');
    await registerWorkspace(sid, unobservedRoom, machineId, '/ws/unobserved');

    await setObservedAt(observedRoom, Date.now());
    // unobservedRoom intentionally has no observation row

    const result = await listForMachine(sid, machineId);
    const chatroomIds = result.map((w) => w.chatroomId);

    expect(chatroomIds).toContain(observedRoom);
    expect(chatroomIds).not.toContain(unobservedRoom);
  });

  test('does not leak recently-observed chatrooms belonging to other machines', async () => {
    const { sessionId: sid } = await createTestSession('test-rows-3');
    const machineId = 'machine-rows-3a';
    const otherMachineId = 'machine-rows-3b';
    await registerMachineWithDaemon(sid, machineId);
    await registerMachineWithDaemon(sid, otherMachineId);

    const myRoom = await createDuoTeamChatroom(sid);
    const otherRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, myRoom, machineId, '/ws/mine');
    await registerWorkspace(sid, otherRoom, otherMachineId, '/ws/theirs');

    const now = Date.now();
    await setObservedAt(myRoom, now);
    await setObservedAt(otherRoom, now);

    const result = await listForMachine(sid, machineId);
    const chatroomIds = result.map((w) => w.chatroomId);

    expect(chatroomIds).toContain(myRoom);
    expect(chatroomIds).not.toContain(otherRoom);
  });
});
