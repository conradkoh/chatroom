/**
 * Event Stream — Integration Tests
 *
 * Verifies that the dual-write layer correctly appends events to
 * `chatroom_eventStream` at each instrumented write site.
 *
 * Tests are written first (TDD) and drive the Phase 2 implementation.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Test 1: agent.requestStart event ────────────────────────────────────────

test('startAgent use case writes agent.requestStart event', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-start-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-start-1';
  await registerMachineWithDaemon(sessionId, machineId);

  // ===== ACTION =====
  await t.run(async (ctx) => {
    const user = await ctx.db.query('users').first();
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();

    return startAgent(
      ctx,
      {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
        reason: 'test',
      },
      machine!
    );
  });

  // ===== VERIFY =====
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  expect(events.length).toBe(1);
  const evt = events[0]!;
  expect(evt.type).toBe('agent.requestStart');
  if (evt.type === 'agent.requestStart') {
    expect(evt.chatroomId).toBe(chatroomId);
    expect(evt.machineId).toBe(machineId);
    expect(evt.role).toBe('builder');
    expect(evt.agentHarness).toBe('opencode');
    expect(evt.model).toBe('claude-sonnet-4');
    expect(evt.workingDir).toBe('/test/workspace');
    expect(evt.reason).toBe('test');
    expect(typeof evt.deadline).toBe('number');
    expect(typeof evt.timestamp).toBe('number');
  }
});

// ─── Test 2: agent.requestStop event ─────────────────────────────────────────

test('stopAgent use case writes agent.requestStop event', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-stop-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-stop-1';
  await registerMachineWithDaemon(sessionId, machineId);

  // ===== ACTION =====
  await t.run(async (ctx) => {
    const user = await ctx.db.query('users').first();
    return stopAgent(ctx, {
      machineId,
      chatroomId,
      role: 'builder',
      userId: user!._id,
      reason: 'test',
    });
  });

  // ===== VERIFY =====
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  expect(events.length).toBe(1);
  const evt = events[0]!;
  expect(evt.type).toBe('agent.requestStop');
  if (evt.type === 'agent.requestStop') {
    expect(evt.chatroomId).toBe(chatroomId);
    expect(evt.machineId).toBe(machineId);
    expect(evt.role).toBe('builder');
    expect(evt.reason).toBe('test');
    expect(typeof evt.deadline).toBe('number');
    expect(typeof evt.timestamp).toBe('number');
  }
});

// ─── Test 3: task.activated event on task creation (pending) ─────────────────

test('task creation writes task.activated event for pending tasks', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-create-1');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // ===== ACTION =====
  await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Build the widget',
    createdBy: 'user',
  });

  // ===== VERIFY =====
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  // Should have exactly one task.activated event
  const activatedEvents = events.filter((e) => e.type === 'task.activated');
  expect(activatedEvents.length).toBe(1);
  const evt = activatedEvents[0]!;
  expect(evt.type).toBe('task.activated');
  if (evt.type === 'task.activated') {
    expect(evt.chatroomId).toBe(chatroomId);
    expect(evt.taskStatus).toBe('pending');
    expect(evt.taskContent).toBe('Build the widget');
    // role should be the entry point (builder) or assigned role
    expect(typeof evt.role).toBe('string');
    expect(typeof evt.timestamp).toBe('number');
  }
});

// ─── Test 4: task.activated event on transition to in_progress ───────────────

test('transitionTask to in_progress writes task.activated event', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-trans-inprog-1');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Create a pending task
  const createResult = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Do some work',
    createdBy: 'user',
  });
  const taskId = createResult.taskId;

  // Claim it (pending → acknowledged)
  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  // Count events so far (includes the task.activated from creation)
  const eventsBefore = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  const countBefore = eventsBefore.length;

  // ===== ACTION =====
  // Transition acknowledged → in_progress
  await t.mutation(api.tasks.startTask, {
    sessionId,
    chatroomId,
    taskId,
    role: 'builder',
  });

  // ===== VERIFY =====
  const eventsAfter = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  // There should be at least one new event
  expect(eventsAfter.length).toBeGreaterThan(countBefore);

  // Find the in_progress activated event
  const inProgressEvent = eventsAfter.find(
    (e) => e.type === 'task.activated' && (e as { taskStatus: string }).taskStatus === 'in_progress'
  );
  expect(inProgressEvent).toBeDefined();
  if (inProgressEvent && inProgressEvent.type === 'task.activated') {
    expect(inProgressEvent.chatroomId).toBe(chatroomId);
    expect(inProgressEvent.taskId).toBe(taskId);
    expect(inProgressEvent.taskStatus).toBe('in_progress');
  }
});

// ─── Test 5: task.completed event on transition to completed ─────────────────

test('transitionTask to completed writes task.completed event', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-trans-done-1');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Create → claim → start task
  const createResult = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Finish the feature',
    createdBy: 'user',
  });
  const taskId = createResult.taskId;

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  await t.mutation(api.tasks.startTask, {
    sessionId,
    chatroomId,
    taskId,
    role: 'builder',
  });

  // Count events before completion
  const eventsBefore = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  const countBefore = eventsBefore.length;

  // ===== ACTION =====
  await t.mutation(api.tasks.completeTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  // ===== VERIFY =====
  const eventsAfter = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  expect(eventsAfter.length).toBeGreaterThan(countBefore);

  const completedEvent = eventsAfter.find((e) => e.type === 'task.completed');
  expect(completedEvent).toBeDefined();
  if (completedEvent && completedEvent.type === 'task.completed') {
    expect(completedEvent.chatroomId).toBe(chatroomId);
    expect(completedEvent.taskId).toBe(taskId);
    expect(completedEvent.finalStatus).toBe('completed');
    expect(typeof completedEvent.role).toBe('string');
    expect(typeof completedEvent.timestamp).toBe('number');
  }
});

// ─── Test 6: agent.exited event via recordAgentExited mutation ────────────────

test('recordAgentExited mutation writes agent.exited event', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-exited-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-exited-1';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create an agent config with a PID so clearing it makes sense
  await t.run(async (ctx) => {
    const user = await ctx.db.query('users').first();
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();

    return startAgent(
      ctx,
      {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
        reason: 'test',
      },
      machine!
    );
  });

  // Set a PID on the agent config
  await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 9999,
  });

  // Count events so far (includes agent.requestStart)
  const eventsBefore = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  const countBefore = eventsBefore.length;

  // ===== ACTION =====
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 9999,
    exitCode: 1,
  });

  // ===== VERIFY =====
  const eventsAfter = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  expect(eventsAfter.length).toBeGreaterThan(countBefore);

  const exitedEvent = eventsAfter.find((e) => e.type === 'agent.exited');
  expect(exitedEvent).toBeDefined();
  if (exitedEvent && exitedEvent.type === 'agent.exited') {
    expect(exitedEvent.chatroomId).toBe(chatroomId);
    expect(exitedEvent.machineId).toBe(machineId);
    expect(exitedEvent.role).toBe('builder');
    expect(exitedEvent.pid).toBe(9999);
    expect(exitedEvent.exitCode).toBe(1);
    expect(typeof exitedEvent.timestamp).toBe('number');
  }

  // Also verify that the PID was cleared on the agent config
  const agentConfig = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
  });
  expect(agentConfig?.spawnedAgentPid).toBeUndefined();
});

// ─── Test 7: Crash triggers agent.requestStart with crash_recovery ────────────

test('recordAgentExited emits agent.requestStart when active task exists and desiredState=running', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-crash-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-crash-1';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set desiredState=running so crash recovery triggers
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
      )
      .first();
    if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
  });

  // Create a pending task via sendMessage (assigns it to entry point 'builder')
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'test task for crash recovery',
    senderRole: 'user',
    type: 'message',
  });

  // ===== ACTION =====
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder', // pair team entry point
    pid: 12345,
    stopReason: 'agent_process.crashed',
  });

  // ===== VERIFY =====
  // An agent.requestStart event should be emitted with reason 'platform.crash_recovery'
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });

  const crashRecoveryEvents = events.filter(
    (e) =>
      e.type === 'agent.requestStart' &&
      (e as { reason?: string }).reason === 'platform.crash_recovery'
  );

  expect(crashRecoveryEvents.length).toBe(1);
});

// ─── Test 8: Intentional stop does NOT schedule ensure-agent ─────────────────

test('recordAgentExited with stopReason=user.stop does NOT schedule ensure-agent', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-crash-2');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-crash-2';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create a pending task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'test task for user stop',
    senderRole: 'user',
    type: 'message',
  });

  // ===== ACTION =====
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    stopReason: 'user.stop', // user stop — no restart
  });

  // ===== VERIFY =====
  // No ensure-agent scheduled function should be added by recordAgentExited
  // We check that none with snapshotUpdatedAt === 0 AND this chatroomId exist
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });

  const crashRecoveryCheck = scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as
      | { snapshotUpdatedAt?: number; chatroomId?: string }
      | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
  expect(crashRecoveryCheck).toBeUndefined();
});

// ─── Test 9: No active task means no ensure-agent scheduled ──────────────────

test('recordAgentExited with crash but no active task does NOT schedule ensure-agent', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-crash-3');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-crash-3';
  await registerMachineWithDaemon(sessionId, machineId);

  // No tasks created

  // ===== ACTION =====
  await t.mutation(api.machines.recordAgentExited, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 12345,
    stopReason: 'agent_process.crashed', // crash, but no task
  });

  // ===== VERIFY =====
  // No ensure-agent scheduled function with snapshotUpdatedAt=0 (crash recovery) for this chatroom
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });

  const crashRecoveryCheck = scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as
      | { snapshotUpdatedAt?: number; chatroomId?: string }
      | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
  expect(crashRecoveryCheck).toBeUndefined();
});

// ─── Test 10: updateSpawnedAgent writes agent.started event ──────────────────

test('updateSpawnedAgent writes agent.started event to event stream', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-started-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-started-1';
  await registerMachineWithDaemon(sessionId, machineId);

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
        role: 'builder',
        userId: user!._id,
        model: 'test-model',
        agentHarness: 'opencode',
        workingDir: '/test/ws',
        reason: 'test',
      },
      machine!
    );
  });

  // Count events before
  const before = await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );

  // ===== ACTION =====
  await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 42001,
    model: 'test-model',
  });

  // ===== VERIFY =====
  const after = await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );

  const startedEvents = after.filter((e) => (e as { type?: string }).type === 'agent.started');
  expect(startedEvents.length).toBeGreaterThanOrEqual(1);

  const latestStarted = startedEvents[startedEvents.length - 1] as {
    type: string;
    pid: number;
    role: string;
    model: string;
  };
  expect(latestStarted.pid).toBe(42001);
  expect(latestStarted.role).toBe('builder');
  expect(latestStarted.model).toBe('test-model');
  expect(after.length).toBeGreaterThan(before.length);
});

// ─── Test 11: updateSpawnedAgent upserts restart metric ──────────────────────

test('updateSpawnedAgent upserts chatroom_agentRestartMetrics — increments on repeated starts', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-metrics-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-metrics-1';
  await registerMachineWithDaemon(sessionId, machineId);

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
        model: 'test-model',
        agentHarness: 'opencode',
        workingDir: '/test/ws',
        reason: 'test',
      },
      machine!
    );
  });

  // ===== ACTION: first start =====
  await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 50001,
    model: 'test-model',
  });

  // ===== VERIFY: count is 1 =====
  const metricsAfterFirst = await t.run(async (ctx) =>
    ctx.db.query('chatroom_agentRestartMetrics').collect()
  );
  const row1 = metricsAfterFirst.find(
    (m) => (m as { machineId: string }).machineId === machineId
  ) as { count: number } | undefined;
  expect(row1).toBeDefined();
  expect(row1!.count).toBe(1);

  // ===== ACTION: second start (same hour bucket, same model) =====
  await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: 50002,
    model: 'test-model',
  });

  // ===== VERIFY: count incremented to 2, still one row =====
  const metricsAfterSecond = await t.run(async (ctx) =>
    ctx.db.query('chatroom_agentRestartMetrics').collect()
  );
  const rowsForMachine = metricsAfterSecond.filter(
    (m) => (m as { machineId: string }).machineId === machineId
  );
  expect(rowsForMachine.length).toBe(1);
  expect((rowsForMachine[0] as { count: number }).count).toBe(2);
});

// ─── Test 12: clearing PID does not write agent.started or update metrics ─────

test('updateSpawnedAgent with null pid does NOT write agent.started or update metrics', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-metrics-2');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-metrics-2';
  await registerMachineWithDaemon(sessionId, machineId);

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
        model: 'test-model',
        agentHarness: 'opencode',
        workingDir: '/test/ws',
        reason: 'test',
      },
      machine!
    );
  });

  const eventsBefore = await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );

  // ===== ACTION: clear pid (agent exited) =====
  await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    pid: undefined, // clear
  });

  // ===== VERIFY: no new agent.started events =====
  const eventsAfter = await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
  const startedEvents = eventsAfter.filter(
    (e) => (e as { type?: string }).type === 'agent.started'
  );
  expect(startedEvents.length).toBe(0);
  expect(eventsAfter.length).toBe(eventsBefore.length); // no new events

  // ===== VERIFY: no metric rows =====
  const metrics = await t.run(async (ctx) =>
    ctx.db.query('chatroom_agentRestartMetrics').collect()
  );
  expect(metrics.filter((m) => (m as { machineId: string }).machineId === machineId).length).toBe(
    0
  );
});

// ─── Eager crash recovery (idle agent restart) ──────────────────────────────

describe('Eager crash recovery (idle agent restart)', () => {
  test('crash with no task + desiredState=running emits agent.requestStart with reason platform.crash_recovery', async () => {
    const { sessionId } = await createTestSession('test-eager-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-eager-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
    });

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'agent_process.crashed',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const crashRecoveryEvents = events.filter(
      (e) =>
        e.type === 'agent.requestStart' &&
        (e as { reason?: string }).reason === 'platform.crash_recovery'
    );
    expect(crashRecoveryEvents.length).toBe(1);

    const evt = crashRecoveryEvents[0] as {
      machineId: string;
      agentHarness: string;
      model: string;
      workingDir: string;
    };
    expect(evt.machineId).toBe(machineId);
    expect(typeof evt.agentHarness).toBe('string');
    expect(typeof evt.model).toBe('string');
    expect(typeof evt.workingDir).toBe('string');
  });

  test('crash with no task + desiredState=stopped does NOT emit agent.requestStart', async () => {
    const { sessionId } = await createTestSession('test-eager-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-eager-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'stopped' });
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'agent_process.crashed',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const crashRecoveryEvents = events.filter(
      (e) =>
        e.type === 'agent.requestStart' &&
        (e as { reason?: string }).reason === 'platform.crash_recovery'
    );
    expect(crashRecoveryEvents.length).toBe(0);
  });

  test('crash with no task + circuitState=open does NOT emit agent.requestStart', async () => {
    const { sessionId } = await createTestSession('test-eager-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-eager-3';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'running', circuitState: 'open' });
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'agent_process.crashed',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const crashRecoveryEvents = events.filter(
      (e) =>
        e.type === 'agent.requestStart' &&
        (e as { reason?: string }).reason === 'platform.crash_recovery'
    );
    expect(crashRecoveryEvents.length).toBe(0);
  });

  test('crash with no task + missing model field does NOT emit agent.requestStart', async () => {
    const { sessionId } = await createTestSession('test-eager-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-eager-4';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'running', model: undefined });
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'agent_process.crashed',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const crashRecoveryEvents = events.filter(
      (e) =>
        e.type === 'agent.requestStart' &&
        (e as { reason?: string }).reason === 'platform.crash_recovery'
    );
    expect(crashRecoveryEvents.length).toBe(0);
  });

  test('crash with active task still emits agent.requestStart with crash_recovery reason', async () => {
    const { sessionId } = await createTestSession('test-eager-5');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-eager-5';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'running' });
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'test task for crash recovery',
      senderRole: 'user',
      type: 'message',
    });

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'agent_process.crashed',
    });

    // Note: The ensureAgentHandler has been removed (PR #98). Now when an agent
    // crashes with an active task, onAgentExited directly emits agent.requestStart
    // with reason 'platform.crash_recovery'.

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const crashRecoveryEvents = events.filter(
      (e) =>
        e.type === 'agent.requestStart' &&
        (e as { reason?: string }).reason === 'platform.crash_recovery'
    );
    // Now we expect a crash_recovery event to be emitted for active tasks too
    expect(crashRecoveryEvents.length).toBe(1);
  });
});

// ─── Test: Deferred config removal via recordAgentExited ─────────────────────

describe('Deferred config removal', () => {
  test('recordAgentExited deletes agent config when config.requestRemoval event exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-config-removal-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-config-removal-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Set a PID on the agent config (marks agent as running)
    const pid = 55555;
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid,
    });

    // Verify config exists and has PID set
    const configBefore = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });
    expect(configBefore).toBeDefined();
    expect(configBefore!.spawnedAgentPid).toBe(pid);

    // Emit a config.requestRemoval event (simulates a deferred removal request)
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'config.requestRemoval',
        chatroomId,
        role: 'builder',
        machineId,
        reason: 'team_switch',
        timestamp: Date.now(),
      });
    });

    // Verify the config is NOT yet deleted (PID guard prevents deletion)
    const configMidway = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });
    expect(configMidway).toBeDefined(); // still exists

    // ===== ACTION =====
    // Agent exits — this clears the PID and then processes the removal request
    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid,
      stopReason: 'user.stop', // agent stopped by user
    });

    // ===== VERIFY =====
    // Config should be deleted now (PID was cleared, then removal processed)
    const configAfter = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });
    expect(configAfter).toBeNull();
  });

  test('recordAgentExited does NOT delete config when no config.requestRemoval event exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-config-removal-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-config-removal-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    const pid = 12345;
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid,
    });

    // ===== ACTION =====
    // Agent exits — no config.requestRemoval event pending
    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid,
      stopReason: 'agent_process.crashed', // crash
    });

    // ===== VERIFY =====
    // Config should still exist (no removal event, so no deletion)
    const configAfter = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', 'builder'))
        )
        .first();
    });
    expect(configAfter).toBeDefined();
    expect(configAfter!.spawnedAgentPid).toBeUndefined(); // PID was cleared
  });
});
