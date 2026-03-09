/**
 * Get Agent Config for Start — Integration Tests
 *
 * Tests the use case that returns form defaults for the "Start Agent" dialog,
 * resolving from preference → teamConfig → machineConfig fallback chain.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getAgentConfigForStart } from '../../src/domain/usecase/agent/get-agent-config-for-start';
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

// ─── No defaults ──────────────────────────────────────────────────────────────

describe('getAgentConfigForStart — no defaults', () => {
  test('returns empty defaults when no preference/config exists', async () => {
    const { sessionId } = await createTestSession('test-gacfs-empty-1');
    const machineId = 'machine-gacfs-empty-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    const result = await t.run(async (ctx) => {
      return getAgentConfigForStart(ctx, {
        chatroomId,
        role: 'builder',
        userId: ownerId,
      });
    });

    expect(result).not.toBeNull();
    expect(result!.role).toBe('builder');
    expect(result!.defaults).toEqual({});
    expect(result!.connectedMachines).toHaveLength(1);
    expect(result!.connectedMachines[0].hostname).toBe('test-host');
  });

  test('only shows connected machines', async () => {
    const { sessionId } = await createTestSession('test-gacfs-conn-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    // Register machine but DON'T connect daemon
    await t.mutation(api.machines.register, {
      sessionId: sessionId as any,
      machineId: 'machine-gacfs-disconnected',
      hostname: 'disconnected-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: ['claude-sonnet-4'] },
    });

    const result = await t.run(async (ctx) => {
      return getAgentConfigForStart(ctx, {
        chatroomId,
        role: 'builder',
        userId: ownerId,
      });
    });

    expect(result!.connectedMachines).toHaveLength(0);
  });
});

// ─── Preference as default ────────────────────────────────────────────────────

describe('getAgentConfigForStart — preference fallback', () => {
  test('returns preference as default when available', async () => {
    const { sessionId } = await createTestSession('test-gacfs-pref-1');
    const machineId = 'machine-gacfs-pref-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    // Save a preference
    await t.mutation(api.machines.saveAgentPreference, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'builder',
      machineId,
      agentHarness: 'opencode',
      model: 'preferred-model',
      workingDir: '/preferred/dir',
    });

    const result = await t.run(async (ctx) => {
      return getAgentConfigForStart(ctx, {
        chatroomId,
        role: 'builder',
        userId: ownerId,
      });
    });

    expect(result!.defaults.machineId).toBe(machineId);
    expect(result!.defaults.agentHarness).toBe('opencode');
    expect(result!.defaults.model).toBe('preferred-model');
    expect(result!.defaults.workingDir).toBe('/preferred/dir');
  });
});

// ─── Team config fallback ─────────────────────────────────────────────────────

describe('getAgentConfigForStart — team config fallback', () => {
  test('falls back to team config when no preference exists', async () => {
    const { sessionId } = await createTestSession('test-gacfs-team-1');
    const machineId = 'machine-gacfs-team-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);
    const ownerId = await getOwnerUserId(chatroomId);

    // Start agent to create team config (no preference saved)
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      return getAgentConfigForStart(ctx, {
        chatroomId,
        role: 'builder',
        userId: ownerId,
      });
    });

    expect(result!.defaults.machineId).toBe(machineId);
    expect(result!.defaults.agentHarness).toBe('opencode');
    expect(result!.defaults.model).toBe('claude-sonnet-4');
    expect(result!.defaults.workingDir).toBe('/test/workspace');
  });
});

// ─── Access control ───────────────────────────────────────────────────────────

describe('getAgentConfigForStart — access control', () => {
  test('returns null for non-owner', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-gacfs-access-1');
    const chatroomId = await createPairTeamChatroom(ownerSession as any);

    await createTestSession('test-gacfs-access-2');

    const result = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      const users = await ctx.db.query('users').collect();
      const nonOwner = users.find((u) => u._id !== room!.ownerId);
      if (!nonOwner) return 'skip';
      return getAgentConfigForStart(ctx, {
        chatroomId,
        role: 'builder',
        userId: nonOwner._id,
      });
    });

    if (result === 'skip') return;
    expect(result).toBeNull();
  });
});
