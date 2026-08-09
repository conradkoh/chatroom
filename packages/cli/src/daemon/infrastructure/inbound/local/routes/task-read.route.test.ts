import { mkdtempSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { handleTaskReadRoute } from './task-read.route.js';
import { openDatabase } from '../../../persistence/open-database.js';
import {
  listTaskReadModelsForChatroomRole,
  upsertTaskReadModel,
} from '../../../persistence/read-models/tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p6-task-read-route-'));
  return join(dir, 'events.sqlite');
}

function makeReq(body: string): IncomingMessage {
  const stream = new Readable();
  stream.push(body);
  stream.push(null);
  return stream as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; captured: { status: number; json: unknown } } {
  const captured: { status: number; json: unknown } = { status: 0, json: undefined };
  const res = {
    writeHead(code: number) {
      captured.status = code;
    },
    end(text: string) {
      captured.json = JSON.parse(text);
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

describe('handleTaskReadRoute', () => {
  it('acknowledges the task locally and returns the prompt payload', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    const appendEvent = vi.fn();
    try {
      upsertTaskReadModel(db, {
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
        status: 'acknowledged',
        assignedTo: 'builder',
        agentHarness: 'opencode',
        machineId: 'machine-1',
        createdAt: 100,
        updatedAt: 100,
      });
      const query = vi.fn().mockResolvedValue({
        _id: 'task-1',
        content: 'do the thing',
        status: 'acknowledged',
        createdAt: 100,
        createdBy: 'planner',
      });

      const { res, captured } = makeRes();
      await handleTaskReadRoute(
        makeReq(JSON.stringify({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' })),
        res,
        { machineId: 'machine-1', sessionId: 'session-1', db, appendEvent, query }
      );

      expect(captured.status).toBe(200);
      expect(captured.json).toMatchObject({ taskId: 'task-1', status: 'in_progress' });
      expect((captured.json as { content: string }).content).toBe('do the thing');
      const row = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder')[0];
      expect(row?.status).toBe('in_progress');
      expect(appendEvent).toHaveBeenCalledTimes(1);
      expect(appendEvent.mock.calls[0][0].type).toBe('task.status_changed');
    } finally {
      db.close();
    }
  });
});
