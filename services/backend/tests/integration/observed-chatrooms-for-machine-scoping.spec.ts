/**
 * Observed Chatrooms For Machine Scoping — Integration Tests
 *
 * Pins that getObservedChatroomsForMachine scopes observation lookups to the
 * machine's own chatrooms (by_chatroomId point lookups), independent of other
 * globally hot observations.
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

const OBSERVATION_TTL_MS = 60_000;

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

async function setObservedAt(
  chatroomId: Id<'chatroom_rooms'>,
  lastObservedAt: number,
  lastRefreshedAt?: number
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('chatroom_observation')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
      .first();
    if (existing) {
      await ctx.db.patch('chatroom_observation', existing._id, {
        lastObservedAt,
        ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {}),
      });
    } else {
      await ctx.db.insert('chatroom_observation', {
        chatroomId,
        lastObservedAt,
        ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {}),
      });
    }
  });
}

async function getObservedForMachine(sessionId: string, machineId: string) {
  return t.query(api.machines.getObservedChatroomsForMachine, {
    sessionId: sessionId as any,
    machineId,
  });
}

describe('getObservedChatroomsForMachine scoping', () => {
  test('returns only this machine’s chatrooms whose observation is within TTL', async () => {
    const { sessionId: sid } = await createTestSession('test-obs-1');
    const machineId = 'machine-obs-1';
    await registerMachineWithDaemon(sid, machineId);

    const recentRoom = await createDuoTeamChatroom(sid);
    const staleRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, recentRoom, machineId, '/ws/recent');
    await registerWorkspace(sid, staleRoom, machineId, '/ws/stale');

    const now = Date.now();
    await setObservedAt(recentRoom, now);
    await setObservedAt(staleRoom, now - 2 * OBSERVATION_TTL_MS);

    const result = await getObservedForMachine(sid, machineId);
    const chatroomIds = result.map((r) => r.chatroomId);

    expect(chatroomIds).toContain(recentRoom);
    expect(chatroomIds).not.toContain(staleRoom);
  });

  test('excludes a machine chatroom with no observation row', async () => {
    const { sessionId: sid } = await createTestSession('test-obs-2');
    const machineId = 'machine-obs-2';
    await registerMachineWithDaemon(sid, machineId);

    const observedRoom = await createDuoTeamChatroom(sid);
    const unobservedRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, observedRoom, machineId, '/ws/observed');
    await registerWorkspace(sid, unobservedRoom, machineId, '/ws/unobserved');

    await setObservedAt(observedRoom, Date.now());
    // unobservedRoom intentionally has no observation row

    const result = await getObservedForMachine(sid, machineId);
    const chatroomIds = result.map((r) => r.chatroomId);

    expect(chatroomIds).toContain(observedRoom);
    expect(chatroomIds).not.toContain(unobservedRoom);
  });

  test('does not include a recently-observed chatroom that belongs only to another machine', async () => {
    const { sessionId: sid } = await createTestSession('test-obs-3');
    const machineId = 'machine-obs-3a';
    const otherMachineId = 'machine-obs-3b';
    await registerMachineWithDaemon(sid, machineId);
    await registerMachineWithDaemon(sid, otherMachineId);

    const myRoom = await createDuoTeamChatroom(sid);
    const otherRoom = await createDuoTeamChatroom(sid);

    await registerWorkspace(sid, myRoom, machineId, '/ws/mine');
    await registerWorkspace(sid, otherRoom, otherMachineId, '/ws/theirs');

    const now = Date.now();
    await setObservedAt(myRoom, now);
    await setObservedAt(otherRoom, now);

    const result = await getObservedForMachine(sid, machineId);
    const chatroomIds = result.map((r) => r.chatroomId);

    expect(chatroomIds).toContain(myRoom);
    expect(chatroomIds).not.toContain(otherRoom);
  });

  test('includes lastRefreshedAt when present on the observation', async () => {
    const { sessionId: sid } = await createTestSession('test-obs-4');
    const machineId = 'machine-obs-4';
    await registerMachineWithDaemon(sid, machineId);

    const room = await createDuoTeamChatroom(sid);
    await registerWorkspace(sid, room, machineId, '/ws/refreshed');

    const now = Date.now();
    await setObservedAt(room, now, /* lastRefreshedAt */ now - 10_000);

    const result = await getObservedForMachine(sid, machineId);
    expect(result).toHaveLength(1);
    expect(result[0]!.lastRefreshedAt).toBe(now - 10_000);
  });
});
