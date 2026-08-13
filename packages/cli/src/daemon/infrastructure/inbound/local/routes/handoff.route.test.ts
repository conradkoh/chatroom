import { mkdtempSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { handleHandoffRoute } from './handoff.route.js';
import { openDatabase } from '../../../persistence/open-database.js';

const mockExecuteHandoff = vi.fn();

vi.mock('../../../../domain/usecase/execute-handoff.js', () => ({
  executeHandoff: (...args: unknown[]) => mockExecuteHandoff(...args),
}));

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-route-'));
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

describe('handleHandoffRoute', () => {
  it('returns success JSON for a valid handoff body', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    mockExecuteHandoff.mockResolvedValue({
      success: true,
      messageId: 'msg-1',
      completedTaskIds: [],
      newTaskId: 'task-1',
      promotedTaskId: null,
    });
    try {
      const { res, captured } = makeRes();
      await handleHandoffRoute(
        makeReq(
          JSON.stringify({
            chatroomId: 'room-1',
            senderRole: 'planner',
            content: 'handoff message',
            targetRole: 'builder',
          })
        ),
        res,
        makeDeps(db)
      );

      expect(captured.status).toBe(200);
      expect((captured.json as { success: boolean }).success).toBe(true);
      expect(mockExecuteHandoff).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'machine-1', db }),
        expect.objectContaining({
          chatroomId: 'room-1',
          senderRole: 'planner',
          targetRole: 'builder',
        })
      );
    } finally {
      db.close();
      mockExecuteHandoff.mockReset();
    }
  });

  it('returns 400 for invalid JSON body', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    try {
      const { res, captured } = makeRes();
      await handleHandoffRoute(makeReq('{not json'), res, makeDeps(db));

      expect(captured.status).toBe(400);
      expect((captured.json as { error?: { code?: string } }).error?.code).toBe('BAD_REQUEST');
      expect(mockExecuteHandoff).not.toHaveBeenCalled();
    } finally {
      db.close();
      mockExecuteHandoff.mockReset();
    }
  });

  it('returns 400 for missing required fields', async () => {
    const db: DatabaseSync = openDatabase(tempDbPath());
    try {
      const { res, captured } = makeRes();
      await handleHandoffRoute(
        makeReq(JSON.stringify({ chatroomId: 'room-1' })),
        res,
        makeDeps(db)
      );

      expect(captured.status).toBe(400);
      expect((captured.json as { error?: { code?: string } }).error?.code).toBe('BAD_REQUEST');
      expect(mockExecuteHandoff).not.toHaveBeenCalled();
    } finally {
      db.close();
      mockExecuteHandoff.mockReset();
    }
  });
});
