import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveClientDistDir, tryServeStatic } from './serve-static.js';

describe('resolveClientDistDir', () => {
  it('resolves to a directory containing index.html', () => {
    const dir = resolveClientDistDir();
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });
});

describe('tryServeStatic', () => {
  it('serves index.html for GET /', () => {
    const distDir = resolveClientDistDir();
    const chunks: Buffer[] = [];
    const res = {
      writeHead: vi.fn(),
      end: (body?: Buffer) => {
        if (body) chunks.push(body);
      },
    } as unknown as ServerResponse;
    const req = { method: 'GET', url: '/' } as IncomingMessage;

    const served = tryServeStatic(req, res, distDir);
    expect(served).toBe(true);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('<div id="root">');
  });
});
