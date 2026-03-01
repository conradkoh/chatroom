/**
 * getLatestAgentEvent — Integration Tests (TDD)
 *
 * Verifies that the query returns the most recent event for a given
 * chatroom + role, using the by_chatroomId_role index, and maps
 * event types correctly for UI status derivation.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
} from '../helpers/integration';

// ─── Test 1: Returns null when no events exist ────────────────────────────────

test('getLatestAgentEvent returns null when no events exist for role', async () => {
  const { sessionId } = await createTestSession('test-glae-empty');
  const chatroomId = await createPairTeamChatroom(sessionId);

  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  expect(result).toBeNull();
});

// ─── Test 2: Returns latest event when multiple events exist ──────────────────

test('getLatestAgentEvent returns the most recent event for the role', async () => {
  const { sessionId } = await createTestSession('test-glae-latest');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Insert agent.registered event (earlier)
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.registered',
      chatroomId,
      role: 'builder',
      agentType: 'custom',
      timestamp: 1000,
    });
  });

  // Insert agent.waiting event (newer, inserted after so it has a higher _creationTime)
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.waiting',
      chatroomId,
      role: 'builder',
      timestamp: 2000,
    });
  });

  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  expect(result).not.toBeNull();
  expect(result?.type).toBe('agent.waiting');
});

// ─── Test 3: Only returns events for the requested role ──────────────────────

test('getLatestAgentEvent only returns events for the requested role', async () => {
  const { sessionId } = await createTestSession('test-glae-role-filter');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Insert an event for 'reviewer' only
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.waiting',
      chatroomId,
      role: 'reviewer',
      timestamp: Date.now(),
    });
  });

  // Query for 'builder' — should return null
  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  expect(result).toBeNull();
});

// ─── Test 4: Authenticated — returns null for unauthenticated session ─────────

test('getLatestAgentEvent returns null for unauthenticated session', async () => {
  const { sessionId: validSession } = await createTestSession('test-glae-auth-valid');
  const chatroomId = await createPairTeamChatroom(validSession);

  // Insert an event
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.waiting',
      chatroomId,
      role: 'builder',
      timestamp: Date.now(),
    });
  });

  // Query with a bad session
  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId: 'not-a-real-session' as any,
    chatroomId,
    role: 'builder',
  });

  expect(result).toBeNull();
});

// ─── Test 5: End-to-end: task.acknowledged appears after claimTask ────────────

test('after claimTask, getLatestAgentEvent returns task.acknowledged for the role', async () => {
  const { sessionId } = await createTestSession('test-glae-claim');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Create a pending task
  await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'test task',
    createdBy: 'user',
  });

  // Register participant so claimTask can auth
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  // Claim the task (pending → acknowledged)
  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  // Query latest event for builder
  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  expect(result).not.toBeNull();
  expect(result?.type).toBe('task.acknowledged');
});

// ─── Test 6: End-to-end: task.inProgress appears after startTask ─────────────

test('after startTask, getLatestAgentEvent returns task.inProgress for the role', async () => {
  const { sessionId } = await createTestSession('test-glae-start');
  const chatroomId = await createPairTeamChatroom(sessionId);

  // Create + claim a task
  const createResult = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'test task',
    createdBy: 'user',
  });

  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  // Start the task (acknowledged → in_progress)
  await t.mutation(api.tasks.startTask, {
    sessionId,
    chatroomId,
    taskId: createResult.taskId,
    role: 'builder',
  });

  // Query latest event
  const result = await t.query(api.machines.getLatestAgentEvent, {
    sessionId,
    chatroomId,
    role: 'builder',
  });

  expect(result).not.toBeNull();
  expect(result?.type).toBe('task.inProgress');
});
