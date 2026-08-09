import { mkdtempSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { handleTasksClaimNextRoute } from './tasks.route.js';
import { openDatabase } from '../../../persistence/open-database.js';
import {
  listTaskReadModelsForChatroomRole,
  upsertTaskReadModel,
} from '../../../persistence/read-models/tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p6-tasks-route-'));
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

function makeDeps(db: DatabaseSync) {
  return {
    machineId: 'machine-1',
    sessionId: 'session-1',
    db,
    appendEvent: vi.fn(),
    query: vi.fn(),
  };
}

describe('handleTasksClaimNextRoute', () => {
  it('claims the next pending task and returns the claim shape', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, {
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
        status: 'pending',
        assignedTo: 'builder',
        agentHarness: 'opencode',
        machineId: 'machine-1',
        createdAt: 100,
        updatedAt: 100,
      });

      const { res, captured } = makeRes();
      await handleTasksClaimNextRoute(
        makeReq(JSON.stringify({ chatroomId: 'room-1', role: 'builder' })),
        res,
        makeDeps(db)
      );

      expect(captured.status).toBe(200);
      expect(captured.json).toEqual({
        success: true,
        taskId: 'task-1',
        status: 'acknowledged',
      });
      const row = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder')[0];
      expect(row?.status).toBe('acknowledged');
    } finally {
      db.close();
    }
  });

  it('returns 409 when no pending task exists', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    try {
      const { res, captured } = makeRes();
      await handleTasksClaimNextRoute(
        makeReq(JSON.stringify({ chatroomId: 'room-1', role: 'planner' })),
        res,
        makeDeps(db)
      );
      expect(captured.status).toBe(409);
      expect(captured.json).toEqual({ success: false, code: 'no_pending' });
    } finally {
      db.close();
    }
  });
});
