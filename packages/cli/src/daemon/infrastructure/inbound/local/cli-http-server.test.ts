import { request } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { startCliHttpServer } from './cli-http-server.js';

function postJson(
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('startCliHttpServer', () => {
  it('binds to 127.0.0.1 and dispatches POST /handoff', async () => {
    const dispatch = vi.fn(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    const server = await startCliHttpServer({ host: '127.0.0.1' }, { dispatch });

    try {
      const res = await postJson(server.port, '/handoff', { chatroomId: 'room-1' });
      expect(res.status).toBe(200);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
    }
  });

  it('rejects non-127.0.0.1 host config', async () => {
    await expect(
      startCliHttpServer({ host: '0.0.0.0' as never }, { dispatch: vi.fn() })
    ).rejects.toThrow('127.0.0.1');
  });
});
