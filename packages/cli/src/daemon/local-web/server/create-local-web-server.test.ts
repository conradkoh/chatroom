import { mkdtempSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { io as ioClient } from 'socket.io-client';
import { describe, expect, it } from 'vitest';

import { startLocalWebServer } from './create-local-web-server.js';
import { createPersistenceStore } from '../../infrastructure/persistence/index.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-local-web-'));
  return join(dir, 'events.sqlite');
}

function tempClientDistDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-local-web-client-'));
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
  return dir;
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
  it('serves the SPA at GET /', async () => {
    const server = await startLocalWebServer(
      { host: '127.0.0.1' },
      { clientDistDir: tempClientDistDir() }
    );
    try {
      const { status, body } = await httpGet(`http://127.0.0.1:${server.port}/`);
      expect(status).toBe(200);
      expect(body).toContain('<div id="root">');
      expect(body).not.toContain('"error":"not_found"');
    } finally {
      await server.stop();
    }
  });

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

  it('releases the bound port after stop so the same port can be reused', async () => {
    const first = await startLocalWebServer({ host: '127.0.0.1', port: 0 });
    const { port } = first;

    await expect(first.stop()).resolves.toBeUndefined();

    const second = await startLocalWebServer({ host: '127.0.0.1', port });
    try {
      expect(second.port).toBe(port);
      const { status } = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(status).toBe(200);
    } finally {
      await second.stop();
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

  it('responds to health.get over socket.io', async () => {
    const server = await startLocalWebServer({ host: '127.0.0.1' });
    const client = ioClient(`http://127.0.0.1:${server.port}`, {
      transports: ['websocket'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });
      const ack = await client.emitWithAck('health.get');
      expect(ack).toEqual({
        ok: true,
        data: { status: 'ok', service: 'v2-local-web', port: server.port },
      });
    } finally {
      client.close();
      await server.stop();
    }
  });

  it('stop resolves while a Socket.IO client is connected', async () => {
    const server = await startLocalWebServer({ host: '127.0.0.1', port: 0 });
    const client = ioClient(`http://127.0.0.1:${server.port}`, {
      transports: ['websocket'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });
      await expect(server.stop()).resolves.toBeUndefined();
    } finally {
      client.close();
    }
  });
});
