/**
 * Machine Agent Lifecycle — Integration Tests
 *
 * Tests the state machine transitions, heartbeat, and reconciliation cron
 * for the chatroom_machineAgentLifecycle table.
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createPairTeamChatroom, createTestSession } from '../helpers/integration';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setup(testId: string) {
  const { sessionId } = await createTestSession(testId);
  const chatroomId = await createPairTeamChatroom(sessionId);
  return { sessionId, chatroomId };
}

async function getLifecycleRow(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_machineAgentLifecycle')
      .withIndex('by_chatroom_team_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('teamId', 'pair').eq('role', role)
      )
      .unique();
  });
}

async function insertLifecycleRow(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  state: string,
  opts: {
    machineId?: string;
    pid?: number;
    heartbeatAt?: number;
    stateChangedAt?: number;
  } = {}
) {
  return t.run(async (ctx) => {
    return ctx.db.insert('chatroom_machineAgentLifecycle', {
      chatroomId,
      teamId: 'pair',
      role,
      state: state as any,
      stateChangedAt: opts.stateChangedAt ?? Date.now(),
      machineId: opts.machineId,
      pid: opts.pid,
      heartbeatAt: opts.heartbeatAt,
    });
  });
}

// ─── Transition Tests ────────────────────────────────────────────────────────

describe('machineAgentLifecycle.transition', () => {
  test('creates new row when transitioning from implicit offline → start_requested', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-create-1');

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'start_requested',
      machineId: 'machine-1',
    });

    expect(result.transitioned).toBe(true);
    expect(result.from).toBe('offline');
    expect(result.to).toBe('start_requested');

    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row).not.toBeNull();
    expect(row!.state).toBe('start_requested');
    expect(row!.machineId).toBe('machine-1');
    expect(row!.teamId).toBe('pair');
  });

  test('transitions start_requested → starting', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-2');
    await insertLifecycleRow(chatroomId, 'builder', 'start_requested', {
      machineId: 'machine-1',
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'starting',
      pid: 12345,
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('starting');
    expect(row!.pid).toBe(12345);
  });

  test('transitions starting → ready and sets heartbeat', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-3');
    await insertLifecycleRow(chatroomId, 'builder', 'starting', {
      machineId: 'machine-1',
      pid: 12345,
    });

    const before = Date.now();
    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'ready',
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('ready');
    expect(row!.heartbeatAt).toBeGreaterThanOrEqual(before);
  });

  test('transitions ready → working', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-4');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      machineId: 'machine-1',
      pid: 12345,
      heartbeatAt: Date.now(),
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'working',
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('working');
  });

  test('transitions ready → stop_requested', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-5');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      machineId: 'machine-1',
      pid: 12345,
      heartbeatAt: Date.now(),
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'stop_requested',
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('stop_requested');
  });

  test('transitions stop_requested → stopping', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-6');
    await insertLifecycleRow(chatroomId, 'builder', 'stop_requested');

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'stopping',
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('stopping');
  });

  test('transitions stopping → offline and clears runtime fields', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-trans-7');
    await insertLifecycleRow(chatroomId, 'builder', 'stopping', {
      machineId: 'machine-1',
      pid: 12345,
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'offline',
    });

    expect(result.transitioned).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
    expect(row!.pid).toBeUndefined();
    expect(row!.heartbeatAt).toBeUndefined();
    expect(row!.connectionId).toBeUndefined();
  });

  test('allows custom agent transition (offline → ready)', async () => {
    // Custom agents self-register without a daemon, so offline → ready must be valid.
    const { sessionId, chatroomId } = await setup('lifecycle-invalid-1');

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'ready',
    });

    expect(result.transitioned).toBe(true);
    expect((result as { from: string }).from).toBe('offline');
    expect((result as { to: string }).to).toBe('ready');
  });

  test('rejects invalid transition (offline → working)', async () => {
    // Even with the custom-agent path, jumping straight to working is not allowed.
    const { sessionId, chatroomId } = await setup('lifecycle-invalid-1b');

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'working',
    });

    expect(result.transitioned).toBe(false);
    expect(result.reason).toContain("Cannot transition from 'offline' to 'working'");
  });

  test('rejects invalid transition (ready → starting)', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-invalid-2');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      heartbeatAt: Date.now(),
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'starting',
    });

    expect(result.transitioned).toBe(false);
    expect(result.reason).toContain("Cannot transition from 'ready' to 'starting'");
  });

  test('rejects same-state transition', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-invalid-3');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      heartbeatAt: Date.now(),
    });

    const result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'ready',
    });

    expect(result.transitioned).toBe(false);
    expect(result.reason).toContain("Already in state 'ready'");
  });
});

// ─── Heartbeat Tests ─────────────────────────────────────────────────────────

describe('machineAgentLifecycle.heartbeat', () => {
  test('updates heartbeatAt when in ready state', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-hb-1');
    const oldHeartbeat = Date.now() - 30_000;
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      heartbeatAt: oldHeartbeat,
    });

    const result = await t.mutation(api.machineAgentLifecycle.heartbeat, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.updated).toBe(true);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.heartbeatAt).toBeGreaterThan(oldHeartbeat);
  });

  test('updates heartbeatAt when in working state', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-hb-2');
    await insertLifecycleRow(chatroomId, 'builder', 'working', {
      heartbeatAt: Date.now() - 30_000,
    });

    const result = await t.mutation(api.machineAgentLifecycle.heartbeat, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.updated).toBe(true);
  });

  test('rejects heartbeat in offline state', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-hb-3');
    await insertLifecycleRow(chatroomId, 'builder', 'offline');

    const result = await t.mutation(api.machineAgentLifecycle.heartbeat, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.updated).toBe(false);
    expect(result.reason).toContain("Cannot heartbeat in state 'offline'");
  });

  test('returns not found when no lifecycle row exists', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-hb-4');

    const result = await t.mutation(api.machineAgentLifecycle.heartbeat, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.updated).toBe(false);
    expect(result.reason).toContain('No lifecycle row found');
  });
});

// ─── Query Tests ─────────────────────────────────────────────────────────────

describe('machineAgentLifecycle.getStatus', () => {
  test('returns null when no lifecycle row exists', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-qs-1');

    const result = await t.query(api.machineAgentLifecycle.getStatus, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result).toBeNull();
  });

  test('returns lifecycle row when it exists', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-qs-2');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      machineId: 'machine-1',
      heartbeatAt: Date.now(),
    });

    const result = await t.query(api.machineAgentLifecycle.getStatus, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result).not.toBeNull();
    expect(result!.state).toBe('ready');
    expect(result!.machineId).toBe('machine-1');
  });
});

describe('machineAgentLifecycle.getTeamStatus', () => {
  test('returns all agents for a chatroom', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-ts-1');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', { heartbeatAt: Date.now() });
    await insertLifecycleRow(chatroomId, 'reviewer', 'offline');

    const result = await t.query(api.machineAgentLifecycle.getTeamStatus, {
      sessionId,
      chatroomId,
    });

    expect(result.agents).toHaveLength(2);
    const states = result.agents.map((a: { role: string; state: string }) => ({
      role: a.role,
      state: a.state,
    }));
    expect(states).toContainEqual({ role: 'builder', state: 'ready' });
    expect(states).toContainEqual({ role: 'reviewer', state: 'offline' });
  });
});

// ─── Reconciliation Cron Tests ───────────────────────────────────────────────

describe('machineAgentLifecycle.reconcile', () => {
  test('expires stale heartbeat: ready → dead', async () => {
    const { chatroomId } = await setup('lifecycle-rc-1');
    const staleHeartbeat = Date.now() - 100_000; // 100s ago, TTL is 90s
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      heartbeatAt: staleHeartbeat,
      stateChangedAt: Date.now() - 100_000,
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.expired).toBe(1);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('dead');
  });

  test('does not expire fresh heartbeat', async () => {
    const { chatroomId } = await setup('lifecycle-rc-2');
    await insertLifecycleRow(chatroomId, 'builder', 'ready', {
      heartbeatAt: Date.now(),
      stateChangedAt: Date.now(),
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.expired).toBe(0);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('ready');
  });

  test('cleans up stuck dead state → offline', async () => {
    const { chatroomId } = await setup('lifecycle-rc-3');
    await insertLifecycleRow(chatroomId, 'builder', 'dead', {
      stateChangedAt: Date.now() - 310_000, // 310s ago, timeout is 300s
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.cleanedUp).toBe(1);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
    expect(row!.pid).toBeUndefined();
  });

  test('cleans up stuck stopping state → offline', async () => {
    const { chatroomId } = await setup('lifecycle-rc-4');
    await insertLifecycleRow(chatroomId, 'builder', 'stopping', {
      stateChangedAt: Date.now() - 310_000, // 310s ago, timeout is 300s
      pid: 12345,
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.cleanedUp).toBe(1);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
    expect(row!.pid).toBeUndefined();
  });

  test('cleans up stuck starting state → offline', async () => {
    const { chatroomId } = await setup('lifecycle-rc-5');
    await insertLifecycleRow(chatroomId, 'builder', 'starting', {
      stateChangedAt: Date.now() - 310_000, // 310s, timeout is 300s
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.cleanedUp).toBe(1);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
  });

  test('does not clean up recent dead state', async () => {
    const { chatroomId } = await setup('lifecycle-rc-6');
    await insertLifecycleRow(chatroomId, 'builder', 'dead', {
      stateChangedAt: Date.now() - 30_000, // 30s ago, timeout is 300s
    });

    const result = await t.mutation(internal.machineAgentLifecycle.reconcile, {});

    expect(result.cleanedUp).toBe(0);
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('dead');
  });
});

// ─── Full Lifecycle Flow ─────────────────────────────────────────────────────

describe('full lifecycle flow', () => {
  test('offline → start_requested → starting → ready → working → stop_requested → stopping → offline', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-flow-1');

    // offline → start_requested
    let result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'start_requested',
      machineId: 'machine-1',
    });
    expect(result.transitioned).toBe(true);

    // start_requested → starting
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'starting',
      pid: 9999,
    });
    expect(result.transitioned).toBe(true);

    // starting → ready
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'ready',
      connectionId: 'conn-123',
    });
    expect(result.transitioned).toBe(true);

    // ready → working
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'working',
    });
    expect(result.transitioned).toBe(true);

    // working → stop_requested
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'stop_requested',
    });
    expect(result.transitioned).toBe(true);

    // stop_requested → stopping
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'stopping',
    });
    expect(result.transitioned).toBe(true);

    // stopping → offline
    result = await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'offline',
    });
    expect(result.transitioned).toBe(true);

    // Verify final state
    const row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
    expect(row!.pid).toBeUndefined();
    expect(row!.heartbeatAt).toBeUndefined();
  });

  test('ready → dead (heartbeat expiry) → offline (cron cleanup)', async () => {
    const { sessionId, chatroomId } = await setup('lifecycle-flow-2');

    // Start agent
    await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'start_requested',
      machineId: 'machine-1',
    });
    await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'starting',
      pid: 9999,
    });
    await t.mutation(api.machineAgentLifecycle.transition, {
      sessionId,
      chatroomId,
      role: 'builder',
      targetState: 'ready',
    });

    // Simulate stale heartbeat by directly patching
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('chatroom_machineAgentLifecycle')
        .withIndex('by_chatroom_team_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('teamId', 'pair').eq('role', 'builder')
        )
        .unique();
      if (row) {
        await ctx.db.patch(row._id, {
          heartbeatAt: Date.now() - 100_000,
        });
      }
    });

    // Run reconciliation — should transition to dead
    let reconcileResult = await t.mutation(internal.machineAgentLifecycle.reconcile, {});
    expect(reconcileResult.expired).toBe(1);

    let row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('dead');

    // Simulate time passing by patching stateChangedAt past the 5 min timeout
    await t.run(async (ctx) => {
      const r = await ctx.db
        .query('chatroom_machineAgentLifecycle')
        .withIndex('by_chatroom_team_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('teamId', 'pair').eq('role', 'builder')
        )
        .unique();
      if (r) {
        await ctx.db.patch(r._id, {
          stateChangedAt: Date.now() - 310_000,
        });
      }
    });

    // Run reconciliation again — should transition dead → offline
    reconcileResult = await t.mutation(internal.machineAgentLifecycle.reconcile, {});
    expect(reconcileResult.cleanedUp).toBe(1);

    row = await getLifecycleRow(chatroomId, 'builder');
    expect(row!.state).toBe('offline');
  });
});
