/**
 * Unit tests for listWorkspaceActivityForMachine.
 *
 * Each test uses its own machineId: the test DB is shared across tests in this file.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { listWorkspaceActivityForMachine } from './list-workspace-activity-for-machine';
import { OBSERVATION_TTL_MS } from '../../../../config/reliability';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

const FIXED_NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Test Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function setupMachine(suffix: string) {
  const { sessionId } = await createSession(`activity-${suffix}`);
  const machineId = `activity-machine-${suffix}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  return { sessionId, machineId };
}

async function registerWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
) {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

async function recordObservation(chatroomId: Id<'chatroom_rooms'>, lastObservedAt: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_observation', { chatroomId, lastObservedAt });
  });
}

function activityFor(machineId: string) {
  return t.run(async (ctx) => listWorkspaceActivityForMachine(ctx, { machineId }));
}

describe('listWorkspaceActivityForMachine', () => {
  test('excludes removed workspaces', async () => {
    const { sessionId, machineId } = await setupMachine('removed');
    const chatroomId = await createChatroom(sessionId);
    const workspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/tmp/act-removed'
    );
    await recordObservation(chatroomId, FIXED_NOW);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', workspaceId, { removedAt: FIXED_NOW - 1_000 });
    });

    expect(await activityFor(machineId)).toEqual([]);
  });

  test('reports null lastObservedAt when the chatroom was never observed', async () => {
    const { sessionId, machineId } = await setupMachine('no-observation');
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/act-unobserved');

    expect(await activityFor(machineId)).toEqual([
      { workingDir: '/tmp/act-unobserved', lastObservedAt: null },
    ]);
  });

  test('deduplicates a workingDir shared by two chatrooms, keeping the max lastObservedAt', async () => {
    const { sessionId, machineId } = await setupMachine('dedupe');
    const older = await createChatroom(sessionId);
    const newer = await createChatroom(sessionId);
    await registerWorkspace(sessionId, older, machineId, '/tmp/act-shared');
    await registerWorkspace(sessionId, newer, machineId, '/tmp/act-shared');
    await recordObservation(older, FIXED_NOW - 10_000);
    await recordObservation(newer, FIXED_NOW - 5_000);

    expect(await activityFor(machineId)).toEqual([
      { workingDir: '/tmp/act-shared', lastObservedAt: FIXED_NOW - 5_000 },
    ]);
  });

  test('a shared workingDir takes the observed chatroom over a never-observed one', async () => {
    const { sessionId, machineId } = await setupMachine('null-vs-number');
    const observed = await createChatroom(sessionId);
    const unobserved = await createChatroom(sessionId);
    await registerWorkspace(sessionId, unobserved, machineId, '/tmp/act-mixed');
    await registerWorkspace(sessionId, observed, machineId, '/tmp/act-mixed');
    await recordObservation(observed, FIXED_NOW - 2_000);

    expect(await activityFor(machineId)).toEqual([
      { workingDir: '/tmp/act-mixed', lastObservedAt: FIXED_NOW - 2_000 },
    ]);
  });

  test('keeps stale observations and does not depend on the current time', async () => {
    const { sessionId, machineId } = await setupMachine('time-independent');
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/act-stale');
    const staleAt = FIXED_NOW - OBSERVATION_TTL_MS - 1_000;
    await recordObservation(chatroomId, staleAt);

    const atFirstTime = await activityFor(machineId);
    vi.setSystemTime(FIXED_NOW + 10 * OBSERVATION_TTL_MS);
    const atLaterTime = await activityFor(machineId);

    expect(atFirstTime).toEqual([{ workingDir: '/tmp/act-stale', lastObservedAt: staleAt }]);
    expect(atLaterTime).toEqual(atFirstTime);
  });

  test('sorts results by workingDir', async () => {
    const { sessionId, machineId } = await setupMachine('sorted');
    const chatroomId = await createChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/act-b');
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/act-a');

    const result = await activityFor(machineId);

    expect(result.map((row) => row.workingDir)).toEqual(['/tmp/act-a', '/tmp/act-b']);
  });
});
