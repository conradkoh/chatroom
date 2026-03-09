/**
 * List Chatroom Agent Overview — Integration Tests
 *
 * Tests the use case that returns per-chatroom agent status summaries
 * without exposing machine-level details.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { listChatroomAgentOverview } from '../../src/domain/usecase/agent/list-chatroom-agent-overview';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function getOwnerUserId(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    return room!.ownerId;
  });
}

// ─── No agents ────────────────────────────────────────────────────────────────

describe('listChatroomAgentOverview — no agents', () => {
  test('returns none status when no machine configs exist', async () => {
    const { sessionId } = await createTestSession('test-lcao-none-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    const results = await t.run(async (ctx) => {
      return listChatroomAgentOverview(ctx, { userId: ownerId });
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('none');
    expect(entry!.runningRoles).toEqual([]);
  });
});

// ─── Running agent ────────────────────────────────────────────────────────────

describe('listChatroomAgentOverview — running agent', () => {
  test('returns running status and role names when agents have PIDs', async () => {
    const { sessionId } = await createTestSession('test-lcao-running-1');
    const machineId = 'machine-lcao-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: sessionId as any,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 99999,
    });

    const results = await t.run(async (ctx) => {
      return listChatroomAgentOverview(ctx, { userId: ownerId });
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('running');
    expect(entry!.runningRoles).toContain('builder');
  });
});

// ─── Stopped agent ────────────────────────────────────────────────────────────

describe('listChatroomAgentOverview — stopped agent', () => {
  test('returns stopped status when config exists but no PID', async () => {
    const { sessionId } = await createTestSession('test-lcao-stopped-1');
    const machineId = 'machine-lcao-stopped-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const results = await t.run(async (ctx) => {
      return listChatroomAgentOverview(ctx, { userId: ownerId });
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('stopped');
    expect(entry!.runningRoles).toEqual([]);
  });
});

// ─── No machineId leaked ─────────────────────────────────────────────────────

describe('listChatroomAgentOverview — no machine details leaked', () => {
  test('overview entries do not contain machineId', async () => {
    const { sessionId } = await createTestSession('test-lcao-noleak-1');
    const machineId = 'machine-lcao-noleak-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const results = await t.run(async (ctx) => {
      return listChatroomAgentOverview(ctx, { userId: ownerId });
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    // Verify the shape only has the expected keys
    const keys = Object.keys(entry!).sort();
    expect(keys).toEqual(['agentStatus', 'chatroomId', 'runningAgents', 'runningRoles']);
  });
});
