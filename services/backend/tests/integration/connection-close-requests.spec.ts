/**
 * connection-close-requests — Integration Tests
 *
 * Tests for the list-based connection close-request mechanism:
 * - Supersede in participants.join appends a close-request row
 * - getPendingTasksForRole returns connection_closed for a live row
 * - confirmConnectionClosed emits event + deletes rows
 * - requestConnectionClose appends a row via the public mutation
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession } from '../helpers/integration';

describe('connection close requests', () => {
  test('supersede appends a close-request row with reason "superseded"', async () => {
    const { sessionId } = await createTestSession('ccr-supersede-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Join with connectionId 'conn-A' and machineId 'machine-1'
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-A',
      machineId: 'machine-1',
    });

    // Join again with connectionId 'conn-B' — should append a close request for 'conn-A'
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-B',
      machineId: 'machine-1',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_connectionCloseRequests')
        .withIndex('by_chatroom_role_connection', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder').eq('connectionId', 'conn-A')
        )
        .collect();
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('superseded');
    expect(rows[0].machineId).toBe('machine-1');
  });

  test('getPendingTasksForRole returns connection_closed for a live close request', async () => {
    const { sessionId } = await createTestSession('ccr-getnext-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Seed a live close request for 'conn-A'
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_connectionCloseRequests', {
        chatroomId,
        role: 'builder',
        connectionId: 'conn-A',
        reason: 'superseded',
        createdAt: now,
        expiresAt: now + 10 * 60_000, // 10 min TTL
      });
    });

    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-A',
    });

    expect(result.type).toBe('connection_closed');
  });

  test('getPendingTasksForRole ignores expired close requests', async () => {
    const { sessionId } = await createTestSession('ccr-expired-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Seed an EXPIRED close request for 'conn-X'
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_connectionCloseRequests', {
        chatroomId,
        role: 'builder',
        connectionId: 'conn-X',
        reason: 'superseded',
        createdAt: now - 20 * 60_000,
        expiresAt: now - 1, // expired
      });
    });

    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-X',
    });

    // Should NOT get connection_closed for expired row
    expect(result.type).not.toBe('connection_closed');
  });

  test('confirmConnectionClosed emits event and removes rows', async () => {
    const { sessionId } = await createTestSession('ccr-confirm-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Seed a close request for 'conn-A'
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_connectionCloseRequests', {
        chatroomId,
        role: 'builder',
        connectionId: 'conn-A',
        machineId: 'machine-1',
        reason: 'superseded',
        createdAt: now,
        expiresAt: now + 10 * 60_000,
      });
    });

    await t.mutation(api.connections.confirmConnectionClosed, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-A',
    });

    // Rows should be gone
    const remainingRows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_connectionCloseRequests')
        .withIndex('by_chatroom_role_connection', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder').eq('connectionId', 'conn-A')
        )
        .collect();
    });
    expect(remainingRows).toHaveLength(0);

    // A connection.terminated event should exist
    const events = await t.run(async (ctx) => {
      return ctx.db.query('chatroom_eventStream').collect();
    });
    const terminatedEvent = events.find(
      (e) => e.type === 'connection.terminated' && (e as any).connectionId === 'conn-A'
    );
    expect(terminatedEvent).toBeDefined();
    expect((terminatedEvent as any).reason).toBe('superseded');
  });

  test('requestConnectionClose appends a row', async () => {
    const { sessionId } = await createTestSession('ccr-request-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.connections.requestConnectionClose, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-Z',
      machineId: 'machine-2',
      reason: 'requested',
    });

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_connectionCloseRequests')
        .withIndex('by_chatroom_role_connection', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder').eq('connectionId', 'conn-Z')
        )
        .collect();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('requested');
    expect(rows[0].machineId).toBe('machine-2');
  });
});
