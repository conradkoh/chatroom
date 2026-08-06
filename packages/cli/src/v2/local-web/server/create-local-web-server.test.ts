import { mkdtempSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { startLocalWebServer } from './create-local-web-server.js';
import { createPersistenceStore } from '../../infrastructure/persistence/index.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-local-web-'));
  return join(dir, 'events.sqlite');
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    }).on('error', reject);
  });
}

describe('startLocalWebServer', () => {
  it('binds 127.0.0.1 and serves /health', async () => {
    const server = await startLocalWebServer({ host: '127.0.0.1' });
    try {
      const { status, body } = await httpGet(`http://127.0.0.1:${server.port}/health`);
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ status: 'ok', service: 'v2-local-web' });
    } finally {
      await server.stop();
    }
  });

  it('rejects non-localhost host', async () => {
    await expect(startLocalWebServer({ host: '0.0.0.0' as '127.0.0.1' })).rejects.toThrow(
      'local-web must bind to 127.0.0.1 only'
    );
  });

  it('serves harness history from persistence', async () => {
    const store = createPersistenceStore(tempDbPath());
    const line = {
      type: 'harness.stream' as const,
      harness: 'h1',
      stream: 'stdout' as const,
      line: 'historical',
      timestamp: 42,
    };
    store.append(line);

    const server = await startLocalWebServer({ host: '127.0.0.1' }, { persistence: store });
    try {
      const { status, body } = await httpGet(
        `http://127.0.0.1:${server.port}/api/harness/history?harness=h1`
      );
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ lines: [line] });
    } finally {
      await server.stop();
      store.close();
    }
  });

  it('delivers harness.stream events over SSE', async () => {
    const server = await startLocalWebServer({ host: '127.0.0.1' });
    const event = {
      type: 'harness.stream' as const,
      harness: 'h1',
      stream: 'stdout' as const,
      line: 'live',
      timestamp: 99,
    };

    const received = await new Promise<string>((resolve, reject) => {
      const req = get(`http://127.0.0.1:${server.port}/events/harness-stream`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString('utf8');
          if (data.includes('data: ')) {
            req.destroy();
            resolve(data);
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);

      setTimeout(() => {
        server.streamHub.publish(event);
      }, 50);
    });

    await server.stop();

    expect(received).toContain(`data: ${JSON.stringify(event)}`);
  });
});
