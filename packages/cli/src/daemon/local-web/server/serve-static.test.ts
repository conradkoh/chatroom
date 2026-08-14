import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { clientDistCandidates, resolveClientDistDir, tryServeStatic } from './serve-static.js';

function createBundledClientFixture(): { distDir: string; clientDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'chatroom-cli-bundle-'));
  const distDir = join(root, 'dist');
  const clientDir = join(distDir, 'client', 'build');
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(join(clientDir, 'index.html'), '<div id="root"></div>');
  return { distDir, clientDir };
}

function createSourceClientFixture(): { serverDir: string; clientDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'chatroom-cli-source-'));
  const serverDir = join(root, 'local-web', 'server');
  const clientDir = join(root, 'local-web', 'client', 'build');
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(join(clientDir, 'index.html'), '<div id="root"></div>');
  return { serverDir, clientDir };
}

describe('clientDistCandidates', () => {
  it('prefers client colocated with bundled dist', () => {
    const { distDir, clientDir } = createBundledClientFixture();
    expect(clientDistCandidates(distDir)[0]).toBe(clientDir);
  });
});

describe('resolveClientDistDir', () => {
  it('resolves bundled dist layout to dist/client/build', () => {
    const { distDir, clientDir } = createBundledClientFixture();
    expect(resolveClientDistDir(distDir)).toBe(clientDir);
    expect(existsSync(join(clientDir, 'index.html'))).toBe(true);
  });

  it('resolves source server layout to ../client/build', () => {
    const { serverDir, clientDir } = createSourceClientFixture();
    expect(resolveClientDistDir(serverDir)).toBe(clientDir);
  });
});

describe('tryServeStatic', () => {
  it('serves index.html for GET /', () => {
    const { clientDir } = createBundledClientFixture();
    const chunks: Buffer[] = [];
    const res = {
      writeHead: vi.fn(),
      end: (body?: Buffer) => {
        if (body) chunks.push(body);
      },
    } as unknown as ServerResponse;
    const req = { method: 'GET', url: '/' } as IncomingMessage;

    const served = tryServeStatic(req, res, clientDir);
    expect(served).toBe(true);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('<div id="root">');
  });
});
