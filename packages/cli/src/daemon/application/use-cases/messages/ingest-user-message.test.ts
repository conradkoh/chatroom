import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ingestUserMessage } from './ingest-user-message.js';
import { isDaemonTaskId } from '../../../domain/entities/daemon-task-id.js';
import { openDatabase } from '../../../infrastructure/persistence/open-database.js';
import { listTaskReadModelsForChatroomRole } from '../../../infrastructure/persistence/read-models/tasks.js';

describe('ingestUserMessage', () => {
  it('stores a planner task, appends projection event, and emits local delivery', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-')), 'events.sqlite'));
    const appendEvent = vi.fn();
    const emitOrchestrationEvent = vi.fn();
    process.env.UNCONDITIONAL_CUTOVER = '1';
    try {
      const result = await ingestUserMessage(
        {
          db,
          machineId: 'machine',
          sessionId: 'session',
          appendEvent,
          emitOrchestrationEvent,
          getAgentHarness: async () => 'opencode',
          query: vi.fn().mockResolvedValue([]),
        },
        {
          chatroomId: 'room',
          messageId: 'message',
          content: 'hello',
          senderRole: 'user',
          entryPointRole: 'planner',
        }
      );
      expect(listTaskReadModelsForChatroomRole(db, 'room', 'planner')[0]).toMatchObject({
        taskId: result.newTaskId,
        taskContent: 'hello',
        status: 'pending',
      });
      expect(isDaemonTaskId(result.newTaskId)).toBe(true);
      expect(
        db
          .prepare(
            "SELECT event_type FROM outbound_events WHERE event_type = 'user-message.received'"
          )
          .all()
      ).toHaveLength(1);
      expect(emitOrchestrationEvent).toHaveBeenCalledWith({
        chatroomId: 'room',
        role: 'planner',
        taskId: result.newTaskId,
        source: 'user-message',
      });
    } finally {
      delete process.env.UNCONDITIONAL_CUTOVER;
      db.close();
    }
  });

  it('emits orchestration with daemonTaskId when Convex task already exists', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-')), 'events.sqlite'));
    const emitOrchestrationEvent = vi.fn();
    const daemonTaskId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    try {
      await ingestUserMessage(
        {
          db,
          machineId: 'machine',
          sessionId: 'session',
          appendEvent: vi.fn(),
          emitOrchestrationEvent,
          getAgentHarness: async () => 'opencode',
          query: vi.fn().mockResolvedValue([
            {
              _id: 'convex-task-id-no-dashes',
              daemonTaskId,
              sourceMessageId: 'message',
              content: 'hello',
              status: 'pending',
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
        },
        {
          chatroomId: 'room',
          messageId: 'message',
          content: 'hello',
          senderRole: 'user',
          entryPointRole: 'planner',
        }
      );
      expect(emitOrchestrationEvent).toHaveBeenCalledWith({
        chatroomId: 'room',
        role: 'planner',
        taskId: daemonTaskId,
        source: 'user-message',
      });
    } finally {
      db.close();
    }
  });
});
