import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadRuntimeDefaults } from './load-runtime-defaults.js';
import { saveSavedRuntimeConfig } from './saved-runtime-config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'local-dev-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

describe('loadRuntimeDefaults', () => {
  it('defaults to local mode with no env files', () => {
    const d = loadRuntimeDefaults(tmpDir, 3847);
    expect(d.convexBackendMode).toBe('local');
    expect(d.webappPort).toBe(3000);
    expect(d.convexUrl).toBe('http://127.0.0.1:3210');
    expect(d.hostedConvexUrlFromEnv).toBeNull();
    expect(d.webappPortFromEnv).toBeNull();
  });

  it('detects hosted convex from backend env', () => {
    const servicesDir = join(tmpDir, 'services/backend');
    ensureDir(servicesDir);
    writeFileSync(
      join(servicesDir, '.env.local'),
      'VITE_CONVEX_URL=https://test-123.convex.cloud\n',
      'utf8'
    );

    const d = loadRuntimeDefaults(tmpDir, 3847);
    expect(d.convexBackendMode).toBe('hosted');
    expect(d.hostedConvexUrlFromEnv).toBe('https://test-123.convex.cloud');
    expect(d.convexUrl).toBe('https://test-123.convex.cloud');
  });

  it('prefers hosted webapp env when backend env is local', () => {
    const servicesDir = join(tmpDir, 'services/backend');
    const appsDir = join(tmpDir, 'apps/webapp');
    ensureDir(servicesDir);
    ensureDir(appsDir);
    writeFileSync(
      join(servicesDir, '.env.local'),
      'VITE_CONVEX_URL=http://127.0.0.1:3210\n',
      'utf8'
    );
    writeFileSync(
      join(appsDir, '.env.local'),
      'NEXT_PUBLIC_CONVEX_URL=https://wonderful-raven-192.convex.cloud\n',
      'utf8'
    );

    const d = loadRuntimeDefaults(tmpDir, 3847);
    expect(d.convexBackendMode).toBe('hosted');
    expect(d.hostedConvexUrlFromEnv).toBe('https://wonderful-raven-192.convex.cloud');
    expect(d.convexUrl).toBe('https://wonderful-raven-192.convex.cloud');
  });

  it('reads webapp port from webapp env', () => {
    const appsDir = join(tmpDir, 'apps/webapp');
    ensureDir(appsDir);
    writeFileSync(join(appsDir, '.env.local'), 'PORT=6249\n', 'utf8');

    const d = loadRuntimeDefaults(tmpDir, 3847);
    expect(d.webappPort).toBe(6249);
    expect(d.webappPortFromEnv).toBe(6249);
  });

  it('prefers saved config over env defaults', () => {
    const appsDir = join(tmpDir, 'apps/webapp');
    ensureDir(appsDir);
    writeFileSync(join(appsDir, '.env.local'), 'PORT=6249\n', 'utf8');

    saveSavedRuntimeConfig(tmpDir, {
      webappPort: 4000,
      convexBackendMode: 'local',
      convexPort: 3220,
      convexUrl: 'http://127.0.0.1:3220',
    });

    const d = loadRuntimeDefaults(tmpDir, 3847);
    expect(d.webappPort).toBe(4000);
    expect(d.convexBackendMode).toBe('local');
    expect(d.convexPort).toBe(3220);
    expect(d.convexUrl).toBe('http://127.0.0.1:3220');
    expect(d.webappPortFromEnv).toBe(6249);
  });
});
