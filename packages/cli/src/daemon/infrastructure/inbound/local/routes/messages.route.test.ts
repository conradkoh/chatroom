import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { handleMessagesListBySenderRoute, handleMessagesListSinceRoute } from './messages.route.js';

function makeReq(path: string): IncomingMessage {
  const stream = new Readable();
  stream.push(null);
  const req = stream as unknown as IncomingMessage;
  Object.defineProperty(req, 'url', { value: path });
  return req;
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

const FIXTURE = [
  {
    _id: 'msg-1',
    _creationTime: 1000,
    type: 'user',
    content: 'hello',
    senderRole: 'user',
    targetRole: null,
    taskStatus: null,
  },
];

describe('messages routes (P6)', () => {
  it('list-since proxies the Convex query and returns the same shape (parity)', async () => {
    const query = vi.fn().mockResolvedValue(FIXTURE);
    const { res, captured } = makeRes();
    await handleMessagesListSinceRoute(
      makeReq('/messages/list-since?chatroomId=room-1&role=builder&sinceMessageId=msg-0&limit=100'),
      res,
      { sessionId: 'session-1', machineId: 'machine-1', query }
    );

    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatroomId: 'room-1', sinceMessageId: 'msg-0', limit: 100 })
    );
    expect(captured.status).toBe(200);
    expect(captured.json).toEqual(FIXTURE);
  });

  it('list-by-sender proxies the Convex query', async () => {
    const query = vi.fn().mockResolvedValue(FIXTURE);
    const { res, captured } = makeRes();
    await handleMessagesListBySenderRoute(
      makeReq(
        '/messages/list-by-sender?chatroomId=room-1&role=builder&senderRole=planner&limit=10'
      ),
      res,
      { sessionId: 'session-1', machineId: 'machine-1', query }
    );

    expect(captured.status).toBe(200);
    expect(captured.json).toEqual(FIXTURE);
  });
});
