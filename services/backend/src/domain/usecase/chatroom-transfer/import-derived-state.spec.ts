/**
 * Chatroom import — derived state after a real import.
 *
 * Exports a small source room, imports it through `runImport` (the real driver
 * over the real Convex mutations), then reads the database. Every assertion is a
 * row count or a row value read with `t.run`, so a projection the apply core
 * forgot (read model, status signal, active header, count, cursor) fails here
 * instead of in a UI that never subscribes to it.
 *
 * The fixture's tasks are deliberately mixed: two active, one completed and one
 * closed. The import resets the active ones to `pending`, so the expected counts
 * are derived from the rows that landed, never from the source file.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { chatroomRowCounts, exportPortFor, importPortFor } from './convex-test-ports';
import { runExport } from './export-driver';
import { runImport } from './import-driver';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let machineCounter = 0;

interface Fixture {
  sessionId: SessionId;
  userId: Id<'users'>;
  targetMachineId: string;
  sourceChatroomId: Id<'chatroom_rooms'>;
}

async function createUser(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  sessionCounter += 1;
  const sessionId = `import-derived-state-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  return { sessionId, userId: login.userId as Id<'users'> };
}

async function registerMachine(sessionId: SessionId): Promise<string> {
  machineCounter += 1;
  const machineId = `import-derived-state-machine-${machineCounter}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'target-host',
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
  return machineId;
}

async function buildFixture(): Promise<Fixture> {
  const { sessionId, userId } = await createUser();
  const targetMachineId = await registerMachine(sessionId);
  const sourceChatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'trio@1',
  });
  await insertSourceRows(sourceChatroomId);
  return { sessionId, userId, targetMachineId, sourceChatroomId };
}

/** Two active tasks, one completed, one closed; a task-linked message and a queue row. */
async function insertSourceRows(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_rooms', chatroomId, {
      name: 'Derived state source',
      status: 'active',
      lastActivityAt: 1_767_225_600_000,
      nextQueuePosition: 4,
    });

    const t0 = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Pending task',
      status: 'pending',
      assignedTo: 'builder',
      queuePosition: 0,
      createdAt: 100,
      updatedAt: 101,
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'In-progress task',
      status: 'in_progress',
      assignedTo: 'reviewer',
      queuePosition: 1,
      createdAt: 110,
      updatedAt: 112,
      startedAt: 110,
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Completed task',
      status: 'completed',
      assignedTo: 'builder',
      queuePosition: 2,
      createdAt: 120,
      updatedAt: 121,
      completedAt: 121,
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Closed task',
      status: 'closed',
      assignedTo: 'builder',
      queuePosition: 3,
      createdAt: 130,
      updatedAt: 131,
    });

    const m0 = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'Please build it',
      type: 'message',
      taskId: t0,
    });
    await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'Any update?',
      type: 'message',
    });
    const m2 = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'builder',
      content: 'Handing back',
      targetRole: 'user',
      type: 'handoff',
      taskOriginMessageId: m0,
      terminalHandoffKey: `${chatroomId}:${m0}:builder:user`,
    });

    await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      content: 'One more thing',
      type: 'message',
      queuePosition: 3,
      attachedMessageIds: [m2],
    });
  });
}

async function importFixture(fixture: Fixture): Promise<Id<'chatroom_rooms'>> {
  const { json } = await runExport(exportPortFor(t, fixture.sessionId), {
    chatroomId: fixture.sourceChatroomId,
    cliVersion: 'test',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const outcome = await runImport(importPortFor(t, fixture.sessionId), {
    json,
    machineId: fixture.targetMachineId,
    dryRun: false,
  });
  if (outcome.status !== 'imported') {
    throw new Error(`expected an imported outcome, got ${outcome.status}`);
  }
  return outcome.chatroomId as Id<'chatroom_rooms'>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function messagesOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function readModelsOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_messageReadModels')
      .withIndex('by_chatroom_createdAt', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function tasksOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function taskCountsOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_taskCounts')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first()
  );
}

function headersOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_activeTaskHeaders')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function signalsOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_timelineTaskStatusSignals')
      .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function queueOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

function unreadRowsOf(chatroomId: Id<'chatroom_rooms'>, userId: Id<'users'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_unreadStatus')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', String(userId)).eq('chatroomId', chatroomId)
      )
      .collect()
  );
}

function readCursorOf(chatroomId: Id<'chatroom_rooms'>, userId: Id<'users'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_read_cursors')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', chatroomId))
      .first()
  );
}

/** Statuses with a materialized counter; `closed` is deliberately absent. */
const COUNTED_STATUSES: readonly [string, string][] = [
  ['pending', 'pending'],
  ['acknowledged', 'acknowledged'],
  ['in_progress', 'inProgress'],
  ['completed', 'completed'],
];

const ACTIVE_STATUSES = new Set(['pending', 'acknowledged', 'in_progress']);

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('derived state after an import', () => {
  test('rebuilds every projection an imported room needs, and nothing live', async () => {
    const fixture = await buildFixture();
    const startedAt = Date.now();
    const chatroomId = await importFixture(fixture);

    // Read models: one per message, with the message's own creation time.
    const messages = await messagesOf(chatroomId);
    const readModels = await readModelsOf(chatroomId);
    expect(messages).toHaveLength(3);
    expect(readModels).toHaveLength(messages.length);
    for (const message of messages) {
      const readModel = readModels.filter((row) => row.messageId === message._id);
      expect(readModel, `read model for ${message._id}`).toHaveLength(1);
      expect(readModel[0].messageCreatedAt).toBe(message._creationTime);
      expect(readModel[0].chatroomId).toBe(chatroomId);
    }

    // Task counts: each counted status equals its row count; queue size equals the queue.
    const tasks = await tasksOf(chatroomId);
    const counts = await taskCountsOf(chatroomId);
    expect(counts).toBeDefined();
    for (const [status, field] of COUNTED_STATUSES) {
      const rows = tasks.filter((task) => task.status === status).length;
      expect(counts?.[field as keyof typeof counts], `count field ${field}`).toBe(rows);
    }
    const queued = await queueOf(chatroomId);
    expect(queued).toHaveLength(1);
    expect(counts?.queueSize).toBe(queued.length);

    // Active headers: one per active task, none for terminal tasks.
    const headers = await headersOf(chatroomId);
    expect(headers).toHaveLength(tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length);
    for (const task of tasks) {
      const header = headers.find((row) => row.taskId === task._id);
      if (!ACTIVE_STATUSES.has(task.status)) {
        expect(header, `header for terminal task ${task._id}`).toBeUndefined();
        continue;
      }
      expect(header, `header for active task ${task._id}`).toBeDefined();
      expect(header?.status).toBe(task.status);
      expect(header?.assignedTo).toBe(task.assignedTo);
    }

    // Timeline signals: one per task, carrying the task's imported status.
    const signals = await signalsOf(chatroomId);
    expect(signals).toHaveLength(tasks.length);
    for (const task of tasks) {
      const forTask = signals.filter((signal) => signal.taskId === task._id);
      expect(forTask, `signals for task ${task._id}`).toHaveLength(1);
      expect(forTask[0].taskStatus).toBe(task.status);
    }

    // The importer starts read: no unread row, and a cursor at or after the import.
    expect(await unreadRowsOf(chatroomId, fixture.userId)).toHaveLength(0);
    const cursor = await readCursorOf(chatroomId, fixture.userId);
    expect(cursor).toBeDefined();
    expect(cursor?.lastSeenAt).toBeGreaterThanOrEqual(startedAt);

    // The list query reports the imported room as read.
    const listed = await t.query(api.chatrooms.listByUserWithStatus, {
      sessionId: fixture.sessionId,
    });
    const room = listed.find((entry) => entry._id === chatroomId);
    expect(room).toBeDefined();
    expect(room?.hasUnread).toBe(false);

    // No live runtime state is carried or created.
    const rowCounts = await chatroomRowCounts(chatroomId);
    expect(rowCounts).not.toHaveProperty('chatroom_agentRuntimeStates');
    expect(rowCounts).not.toHaveProperty('chatroom_participants');

    // No start command was published to the target machine.
    const startCommands = await t.run(async (ctx) => {
      const rows = await ctx.db.query('chatroom_machineCommandInbox').collect();
      return rows.filter(
        (row) =>
          row.machineId === fixture.targetMachineId && row.command.type === 'agent.requestStart'
      );
    });
    expect(startCommands).toHaveLength(0);
  });
});
