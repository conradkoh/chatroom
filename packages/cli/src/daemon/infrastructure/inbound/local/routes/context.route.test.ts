import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { handleContextReadRoute } from './context.route.js';

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

const FIXTURE = {
  messages: [{ _id: 'msg-1', senderRole: 'planner', type: 'handoff', content: 'go' }],
  pendingTasksForRole: 1,
};

describe('context route (P6)', () => {
  it('read proxies the Convex query and returns the same shape (parity)', async () => {
    const query = vi.fn().mockResolvedValue(FIXTURE);
    const { res, captured } = makeRes();
    await handleContextReadRoute(makeReq('/context/read?chatroomId=room-1&role=builder'), res, {
      sessionId: 'session-1',
      query,
    });

    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatroomId: 'room-1', role: 'builder' })
    );
    expect(captured.status).toBe(200);
    expect(captured.json).toEqual(FIXTURE);
  });
});
