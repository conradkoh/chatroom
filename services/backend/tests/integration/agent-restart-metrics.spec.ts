/**
 * Agent Restart Metrics — Integration Tests
 *
 * Verifies that `getAgentRestartMetrics` returns correct hourly restart counts
 * across all three scope modes: machine-wide, per-chatroom, and per-workspace.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import type { SessionId } from 'convex-helpers/server/sessions';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupAgentAndSeedMetrics(opts: {
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  model: string;
  workingDir: string;
  startCount: number;
}) {
  const { sessionId, chatroomId, machineId, role, model, workingDir, startCount } = opts;

  // Ensure agent config exists
  await t.run(async (ctx) => {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    const user = await ctx.db.query('users').first();
    return startAgent(
      ctx,
      {
        machineId,
        chatroomId,
        role,
        userId: user!._id,
        model,
        agentHarness: 'opencode',
        workingDir,
        reason: 'test',
      },
      machine!
    );
  });

  // Record N agent starts to seed the metric
  for (let i = 0; i < startCount; i++) {
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role,
      pid: 10000 + i,
      model,
    });
  }
}

// ─── Test 1: machine-wide scope returns aggregated counts ─────────────────────

test('getAgentRestartMetrics machine-wide scope returns hourly restart counts', async () => {
  const { sessionId } = await createTestSession('metrics-q-machine-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-mq-1';
  await registerMachineWithDaemon(sessionId, machineId);

  await setupAgentAndSeedMetrics({
    sessionId,
    chatroomId,
    machineId,
    role: 'builder',
    model: 'test-model-a',
    workingDir: '/test/workspace',
    startCount: 3,
  });

  const now = Date.now();
  const result = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  // Should have exactly 1 hour bucket (all starts happened in the same hour)
  expect(result.length).toBe(1);
  expect(result[0].byModel['test-model-a']).toBe(3);
});

// ─── Test 2: per-chatroom scope filters correctly ─────────────────────────────

test('getAgentRestartMetrics chatroomId scope returns only that chatroom\'s data', async () => {
  const { sessionId } = await createTestSession('metrics-q-chatroom-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const chatroomId2 = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-cq-1';
  await registerMachineWithDaemon(sessionId, machineId);

  // Seed 2 starts in chatroom 1
  await setupAgentAndSeedMetrics({
    sessionId,
    chatroomId,
    machineId,
    role: 'builder',
    model: 'model-x',
    workingDir: '/test/ws',
    startCount: 2,
  });

  // Also need agent config for chatroom2
  await t.run(async (ctx) => {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    const user = await ctx.db.query('users').first();
    return startAgent(
      ctx,
      {
        machineId,
        chatroomId: chatroomId2,
        role: 'builder',
        userId: user!._id,
        model: 'model-x',
        agentHarness: 'opencode',
        workingDir: '/test/ws',
        reason: 'test',
      },
      machine!
    );
  });

  // Seed 5 starts in chatroom 2
  for (let i = 0; i < 5; i++) {
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId: chatroomId2,
      role: 'builder',
      pid: 20000 + i,
      model: 'model-x',
    });
  }

  const now = Date.now();
  // Query scoped to chatroom 1
  const result = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    chatroomId,
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  expect(result.length).toBe(1);
  expect(result[0].byModel['model-x']).toBe(2); // only chatroom 1's data

  // Query scoped to chatroom 2 — should have 5
  const result2 = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    chatroomId: chatroomId2,
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  expect(result2.length).toBe(1);
  expect(result2[0].byModel['model-x']).toBe(5);
});

// ─── Test 3: workspace scope (workingDir) filters correctly ───────────────────

test('getAgentRestartMetrics workingDir scope filters to that workspace', async () => {
  const { sessionId } = await createTestSession('metrics-q-workspace-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-wq-1';
  await registerMachineWithDaemon(sessionId, machineId);

  await setupAgentAndSeedMetrics({
    sessionId,
    chatroomId,
    machineId,
    role: 'builder',
    model: 'model-ws',
    workingDir: '/workspace/projectA',
    startCount: 4,
  });

  const now = Date.now();
  // Query with correct workingDir
  const result = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    workingDir: '/workspace/projectA',
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  expect(result.length).toBe(1);
  expect(result[0].byModel['model-ws']).toBe(4);

  // Query with different workingDir — should return empty
  const resultOther = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    workingDir: '/workspace/projectB',
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  expect(resultOther.length).toBe(0);
});

// ─── Test 4: multiple models in same hour create separate byModel entries ─────

test('getAgentRestartMetrics groups multiple models within the same hour', async () => {
  const { sessionId } = await createTestSession('metrics-q-multimodel-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-mm-1';
  await registerMachineWithDaemon(sessionId, machineId);

  // Setup agent config once (shared workingDir)
  await t.run(async (ctx) => {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    const user = await ctx.db.query('users').first();
    return startAgent(
      ctx,
      {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        model: 'model-alpha',
        agentHarness: 'opencode',
        workingDir: '/test/ws',
        reason: 'test',
      },
      machine!
    );
  });

  // 2 starts with model-alpha
  for (let i = 0; i < 2; i++) {
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 30000 + i,
      model: 'model-alpha',
    });
  }

  // 3 starts with model-beta
  for (let i = 0; i < 3; i++) {
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 40000 + i,
      model: 'model-beta',
    });
  }

  const now = Date.now();
  const result = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    startTime: now - 24 * 3_600_000,
    endTime: now,
  });

  expect(result.length).toBe(1);
  expect(result[0].byModel['model-alpha']).toBe(2);
  expect(result[0].byModel['model-beta']).toBe(3);
});

// ─── Test 5: range cap at 720 hours (30 days) ────────────────────────────────

test('getAgentRestartMetrics caps range at 720h and returns empty when no data', async () => {
  const { sessionId } = await createTestSession('metrics-q-cap-1');
  const machineId = 'machine-cap-1';
  await registerMachineWithDaemon(sessionId, machineId);

  const now = Date.now();
  // No data seeded; range exceeds 720h — should be capped
  const result = await t.query(api.machines.getAgentRestartMetrics, {
    sessionId,
    machineId,
    role: 'builder',
    startTime: now - 9999 * 3_600_000,
    endTime: now,
  });

  // No metric rows = empty array
  expect(result).toEqual([]);
});
