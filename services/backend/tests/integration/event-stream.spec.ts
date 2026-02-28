/**
 * Event Stream — Integration Tests
 *
 * Verifies that the dual-write layer correctly appends events to
 * `chatroom_eventStream` at each instrumented write site.
 *
 * Tests are written first (TDD) and drive the Phase 2 implementation.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Test 1: command.startAgent event ────────────────────────────────────────

test('startAgent use case writes command.startAgent event', async () => {
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
  expect(evt.type).toBe('command.startAgent');
  if (evt.type === 'command.startAgent') {
    expect(evt.chatroomId).toBe(chatroomId);
    expect(evt.machineId).toBe(machineId);
    expect(evt.role).toBe('builder');
    expect(evt.agentHarness).toBe('opencode');
    expect(evt.model).toBe('claude-sonnet-4');
    expect(evt.workingDir).toBe('/test/workspace');
    expect(evt.reason).toBe('test');
    expect(typeof evt.timestamp).toBe('number');
  }
});

// ─── Test 2: command.stopAgent event ─────────────────────────────────────────

test('stopAgent use case writes command.stopAgent event', async () => {
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
  expect(evt.type).toBe('command.stopAgent');
  if (evt.type === 'command.stopAgent') {
    expect(evt.chatroomId).toBe(chatroomId);
    expect(evt.machineId).toBe(machineId);
    expect(evt.role).toBe('builder');
    expect(evt.reason).toBe('test');
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

  // Count events so far (includes command.startAgent)
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
    intentional: false,
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
    expect(exitedEvent.intentional).toBe(false);
    expect(exitedEvent.exitCode).toBe(1);
    expect(typeof exitedEvent.timestamp).toBe('number');
  }

  // Also verify that the PID was cleared on the agent config
  const agentConfig = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_machineAgentConfigs')
      .withIndex('by_machine_chatroom_role', (q) =>
        q.eq('machineId', machineId).eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .first();
  });
  expect(agentConfig?.spawnedAgentPid).toBeUndefined();
});

// ─── Test 7: Crash triggers immediate ensure-agent ────────────────────────────

test('recordAgentExited with intentional=false schedules ensure-agent when active task exists', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-crash-1');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-crash-1';
  await registerMachineWithDaemon(sessionId, machineId);

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
    intentional: false,
  });

  // ===== VERIFY =====
  // An ensure-agent scheduled function should exist for this chatroom
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });

  // Find the crash-recovery scheduled function: snapshotUpdatedAt=0 for this chatroom
  const ensureCheck = scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as { snapshotUpdatedAt?: number; chatroomId?: string } | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
  expect(ensureCheck).toBeDefined();
});

// ─── Test 8: Intentional stop does NOT schedule ensure-agent ─────────────────

test('recordAgentExited with intentional=true does NOT schedule ensure-agent', async () => {
  // ===== SETUP =====
  const { sessionId } = await createTestSession('test-es-crash-2');
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = 'machine-es-crash-2';
  await registerMachineWithDaemon(sessionId, machineId);

  // Create a pending task
  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    content: 'test task for intentional stop',
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
    intentional: true, // intentional stop
  });

  // ===== VERIFY =====
  // No ensure-agent scheduled function should be added by recordAgentExited
  // We check that none with snapshotUpdatedAt === 0 AND this chatroomId exist
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });

  const crashRecoveryCheck = scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as { snapshotUpdatedAt?: number; chatroomId?: string } | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
  expect(crashRecoveryCheck).toBeUndefined();
});

// ─── Test 9: No active task means no ensure-agent scheduled ──────────────────

test('recordAgentExited with intentional=false but no active task does NOT schedule ensure-agent', async () => {
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
    intentional: false, // unintentional crash, but no task
  });

  // ===== VERIFY =====
  // No ensure-agent scheduled function with snapshotUpdatedAt=0 (crash recovery) for this chatroom
  const scheduled = await t.run(async (ctx) => {
    return ctx.db.system.query('_scheduled_functions').collect();
  });

  const crashRecoveryCheck = scheduled.find((s) => {
    const argsArray = (s as { args?: unknown[] }).args;
    const checkArgs = argsArray?.[0] as { snapshotUpdatedAt?: number; chatroomId?: string } | undefined;
    return checkArgs?.snapshotUpdatedAt === 0 && checkArgs?.chatroomId === chatroomId;
  });
  expect(crashRecoveryCheck).toBeUndefined();
});

