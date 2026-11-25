/**
 * Chatroom import apply — message, task, queue and link phases.
 *
 * Every spec drives the public `api.chatroomImport` mutations through
 * `convex-test`; the assertions read the database afterwards. The rows are
 * written by the apply core, so a missing projection (read model, active header,
 * signal, count) fails here rather than in a UI that never sees it.
 *
 * `refs` is supplied by hand here; `import-driver.spec.ts` covers the driver that
 * fills it. A chunk's `refs` maps the file key to the target id, including the
 * patch's own key for a `links` chunk.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode } from './convex-test-ports';
import type { ImportChunk, ImportHeader, ImportRowPayload } from './import-apply';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let machineCounter = 0;

interface UserFixture {
  sessionId: SessionId;
  userId: Id<'users'>;
}

async function createUser(): Promise<UserFixture> {
  sessionCounter += 1;
  const sessionId = `import-apply-rows-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  return { sessionId, userId: login.userId as Id<'users'> };
}

async function registerMachine(sessionId: SessionId, hostname = 'test-host'): Promise<string> {
  machineCounter += 1;
  const machineId = `import-apply-rows-machine-${machineCounter}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname,
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
  return machineId;
}

function header(overrides: Partial<ImportHeader> = {}): ImportHeader {
  return { teamStructureId: 'trio@1', name: 'Imported room', ...overrides };
}

async function begin(
  sessionId: SessionId,
  machineId: string,
  overrides: Partial<ImportHeader> = {}
): Promise<Id<'chatroom_rooms'>> {
  const result = await t.mutation(api.chatroomImport.begin, {
    sessionId,
    header: header(overrides),
    machineId,
  });
  return result.chatroomId;
}

async function apply(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  chunk: ImportChunk
): Promise<{ created: Record<string, string> }> {
  return await t.mutation(api.chatroomImport.applyChunk, { sessionId, chatroomId, chunk });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the mutation to fail');
}

function messageRow(key: string, overrides: Record<string, unknown> = {}): ImportRowPayload {
  return {
    key,
    fields: { senderRole: 'user', content: `message ${key}`, type: 'message', ...overrides },
  };
}

function taskRow(
  key: string,
  status: string,
  overrides: Record<string, unknown> = {}
): ImportRowPayload {
  return {
    key,
    fields: {
      createdBy: 'user',
      content: `task ${key}`,
      status,
      queuePosition: Number(key.replace('t', '')),
      createdAt: 10,
      updatedAt: 20,
      ...overrides,
    },
  };
}

function queueRow(key: string, position: number): ImportRowPayload {
  return {
    key,
    fields: {
      senderRole: 'user',
      content: `queued ${key}`,
      type: 'message',
      queuePosition: position,
    },
  };
}

/** A test room plus one user; the common start of every case. */
async function importRoom(): Promise<{
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
}> {
  const { sessionId } = await createUser();
  const machineId = await registerMachine(sessionId);
  const chatroomId = await begin(sessionId, machineId);
  return { sessionId, chatroomId };
}

async function messagesOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function readModelsOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroom_messageReadModels')
      .withIndex('by_chatroom_createdAt', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function taskCountsOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroom_taskCounts')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first()
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe('messages', () => {
  test('writes rows in order with one read model each and derives a handoff key', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const first = await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [messageRow('m0'), messageRow('m1')],
      refs: {},
    });
    const originId = first.created.m0;

    await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [
        messageRow('m2', {
          senderRole: 'builder',
          content: 'done',
          type: 'handoff',
          taskOriginMessageId: 'm0',
          terminalHandoffRole: 'planner',
        }),
      ],
      refs: { m0: originId },
    });

    const messages = await messagesOf(chatroomId);
    expect(messages.map((message) => message.content)).toEqual([
      'message m0',
      'message m1',
      'done',
    ]);
    const [firstMessage, secondMessage, handoff] = messages;
    expect(firstMessage._creationTime).toBeLessThan(secondMessage._creationTime);
    expect(secondMessage._creationTime).toBeLessThan(handoff._creationTime);

    expect(handoff.terminalHandoffKey).toBe(`${chatroomId}:${originId}:planner:user`);
    expect(handoff.taskOriginMessageId).toBe(originId);
    expect(handoff).not.toHaveProperty('terminalHandoffRole');

    const readModels = await readModelsOf(chatroomId);
    expect(readModels).toHaveLength(3);
    for (const message of messages) {
      const readModel = readModels.find((row) => row.messageId === message._id);
      expect(readModel).toBeDefined();
      expect(readModel?.messageCreatedAt).toBe(message._creationTime);
      expect(readModel?.chatroomId).toBe(chatroomId);
    }
  });

  test('refuses a row that carries the derived key or an unresolved handoff role', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const injectedKey = await failure(
      apply(sessionId, chatroomId, {
        phase: 'messages',
        rows: [messageRow('m0', { terminalHandoffKey: `${chatroomId}:x:planner:user` })],
        refs: {},
      })
    );
    expect(errorCode(injectedKey)).toBe('IMPORT_CHUNK_FAILED');

    const roleWithoutOrigin = await failure(
      apply(sessionId, chatroomId, {
        phase: 'messages',
        rows: [messageRow('m1', { terminalHandoffRole: 'planner' })],
        refs: {},
      })
    );
    expect(errorCode(roleWithoutOrigin)).toBe('IMPORT_CHUNK_FAILED');

    expect(await messagesOf(chatroomId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('links', () => {
  test('links a deferred origin and derives the handoff key after the patch', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const origin = await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [messageRow('m0')],
      refs: {},
    });
    const originId = origin.created.m0;
    const handoff = await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [messageRow('m1', { senderRole: 'builder', content: 'done', type: 'handoff' })],
      refs: {},
    });
    const messageId = handoff.created.m1;

    await apply(sessionId, chatroomId, {
      phase: 'links',
      patches: [
        {
          table: 'messages',
          key: 'm1',
          fields: { taskOriginMessageId: 'm0', terminalHandoffRole: 'planner' },
        },
      ],
      refs: { m0: originId, m1: messageId },
    });

    const message = await t.run((ctx) =>
      ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>)
    );
    expect(message?.taskOriginMessageId).toBe(originId);
    expect(message?.terminalHandoffKey).toBe(`${chatroomId}:${originId}:planner:user`);

    const readModels = await readModelsOf(chatroomId);
    expect(readModels).toHaveLength(2);
    expect(readModels.find((row) => row.messageId === messageId)?.messageCreatedAt).toBe(
      message?._creationTime
    );
  });

  test('links a message to a task and syncs the read model', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const message = await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [messageRow('m0')],
      refs: {},
    });
    const messageId = message.created.m0;
    const task = await apply(sessionId, chatroomId, {
      phase: 'tasks',
      rows: [taskRow('t0', 'pending')],
      refs: {},
    });
    const taskId = task.created.t0;

    await apply(sessionId, chatroomId, {
      phase: 'links',
      patches: [{ table: 'messages', key: 'm0', fields: { taskId: 't0' } }],
      refs: { t0: taskId, m0: messageId },
    });

    const linked = await t.run((ctx) =>
      ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>)
    );
    expect(linked?.taskId).toBe(taskId);

    const readModel = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', messageId as Id<'chatroom_messages'>))
        .first()
    );
    expect(readModel?.taskId).toBe(taskId);
  });

  test('refuses another chatroom row, a non-ref field and a role without an origin', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const elsewhere = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });
    const foreignMessageId = await t.run((ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId: elsewhere,
        senderRole: 'user',
        content: 'other',
        type: 'message',
      })
    );

    const crossChatroom = await failure(
      apply(sessionId, chatroomId, {
        phase: 'links',
        patches: [{ table: 'messages', key: 'm0', fields: {} }],
        refs: { m0: foreignMessageId },
      })
    );
    expect(errorCode(crossChatroom)).toBe('IMPORT_CHUNK_FAILED');

    const task = await apply(sessionId, chatroomId, {
      phase: 'tasks',
      rows: [taskRow('t0', 'pending')],
      refs: {},
    });
    const taskId = task.created.t0;

    const nonRefField = await failure(
      apply(sessionId, chatroomId, {
        phase: 'links',
        patches: [{ table: 'tasks', key: 't0', fields: { status: 'completed' } }],
        refs: { t0: taskId },
      })
    );
    expect(errorCode(nonRefField)).toBe('IMPORT_CHUNK_FAILED');

    const unchanged = await t.run((ctx) =>
      ctx.db.get('chatroom_tasks', taskId as Id<'chatroom_tasks'>)
    );
    expect(unchanged?.status).toBe('pending');

    const message = await apply(sessionId, chatroomId, {
      phase: 'messages',
      rows: [messageRow('m0')],
      refs: {},
    });
    const messageId = message.created.m0;

    const roleWithoutOrigin = await failure(
      apply(sessionId, chatroomId, {
        phase: 'links',
        patches: [{ table: 'messages', key: 'm0', fields: { terminalHandoffRole: 'planner' } }],
        refs: { m0: messageId },
      })
    );
    expect(errorCode(roleWithoutOrigin)).toBe('IMPORT_CHUNK_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

describe('tasks', () => {
  test('writes rows verbatim with signals, the active header and status counts', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const result = await apply(sessionId, chatroomId, {
      phase: 'tasks',
      rows: [
        taskRow('t0', 'pending', { assignedTo: 'builder' }),
        taskRow('t1', 'pending'),
        taskRow('t2', 'completed'),
        taskRow('t3', 'closed'),
      ],
      refs: {},
    });

    const tasks = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(tasks.map((task) => task.status)).toEqual(['pending', 'pending', 'completed', 'closed']);

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_timelineTaskStatusSignals')
        .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(signals).toHaveLength(4);
    for (const task of tasks) {
      const signalsForTask = signals.filter((signal) => signal.taskId === task._id);
      expect(signalsForTask).toHaveLength(1);
      expect(signalsForTask[0].taskStatus).toBe(task.status);
    }

    const headers = await t.run((ctx) =>
      ctx.db
        .query('chatroom_activeTaskHeaders')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].taskId).toBe(result.created.t0);
    expect(headers[0].assignedTo).toBe('builder');
    expect(headers[0].status).toBe('pending');

    const counts = await taskCountsOf(chatroomId);
    expect(counts).toMatchObject({
      pending: 2,
      acknowledged: 0,
      inProgress: 0,
      completed: 1,
      backlogCount: 0,
      pendingReviewCount: 0,
    });
  });

  test('counts in-progress tasks without writing backlog or review counts', async () => {
    const { sessionId, chatroomId } = await importRoom();

    await apply(sessionId, chatroomId, {
      phase: 'tasks',
      rows: [taskRow('t0', 'in_progress', { assignedTo: 'builder' }), taskRow('t1', 'closed')],
      refs: {},
    });

    const counts = await taskCountsOf(chatroomId);
    expect(counts).toMatchObject({
      pending: 0,
      inProgress: 1,
      completed: 0,
      backlogCount: 0,
      pendingReviewCount: 0,
    });

    const headers = await t.run((ctx) =>
      ctx.db
        .query('chatroom_activeTaskHeaders')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(headers).toHaveLength(1);
    expect(headers[0].status).toBe('in_progress');
  });

  test('refuses a row that carries the assigned chatroom field', async () => {
    const { sessionId, chatroomId } = await importRoom();

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'tasks',
        rows: [taskRow('t0', 'pending', { chatroomId })],
        refs: {},
      })
    );
    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');

    const tasks = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Message queue
// ---------------------------------------------------------------------------

describe('message queue', () => {
  test('writes queued rows verbatim and counts them as the queue size', async () => {
    const { sessionId, chatroomId } = await importRoom();

    await apply(sessionId, chatroomId, {
      phase: 'messageQueue',
      rows: [queueRow('q0', 0), queueRow('q1', 1)],
      refs: {},
    });

    const queued = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(queued.map((row) => [row.content, row.queuePosition, row.type])).toEqual([
      ['queued q0', 0, 'message'],
      ['queued q1', 1, 'message'],
    ]);

    const counts = await taskCountsOf(chatroomId);
    expect(counts?.queueSize).toBe(queued.length);
  });
});
