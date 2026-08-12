import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { clientDistCandidates, resolveClientDistDir, tryServeStatic } from './serve-static.js';

describe('resolveClientDistDir', () => {
  it('resolves to a directory containing index.html', () => {
    const dir = resolveClientDistDir();
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('resolves from bundled dist/index.js layout', () => {
    const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const distDir = join(cliRoot, 'dist');
    const candidates = clientDistCandidates(distDir);
    const match = candidates.find((dir) => existsSync(join(dir, 'index.html')));
    expect(match).toBe(join(cliRoot, 'src/daemon/local-web/client/build'));
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
