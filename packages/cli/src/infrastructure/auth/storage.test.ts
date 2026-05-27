import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getConvexUrl } from '../convex/client.js';

const CURRENT_URL = 'https://unit-test.convex.cloud';
const OTHER_URL = 'https://other.convex.cloud';
const PRODUCTION_URL = 'https://chatroom-cloud.duskfare.com';

vi.mock('../convex/client.js', () => ({
  getConvexUrl: vi.fn(() => CURRENT_URL),
}));

async function loadStorage() {
  vi.resetModules();
  return await import('./storage.js');
}

describe('auth storage', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `chatroom-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    vi.stubEnv('HOME', testHome);
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('saves, loads, and clears auth data in multi-env format', async () => {
    const storage = await loadStorage();

    await storage.saveAuthData({
      sessionId: 'session-current' as never,
      createdAt: '2024-01-02T03:04:05.000Z',
      deviceName: 'test-host (darwin)',
      cliVersion: '1.2.3',
    });

    const authPath = storage.getAuthFilePath();
    const mode = statSync(authPath).mode & 0o777;
    expect(mode).toBe(0o600);

    const content = readFileSync(authPath, 'utf-8');
    expect(content).toContain('// Chatroom CLI Authentication');
    expect(content).toContain('"version": 2');
    expect(content).toContain(CURRENT_URL);

    await expect(storage.loadAuthData()).resolves.toEqual({
      sessionId: 'session-current',
      createdAt: '2024-01-02T03:04:05.000Z',
      deviceName: 'test-host (darwin)',
      cliVersion: '1.2.3',
    });

    await expect(storage.isAuthenticated()).resolves.toBe(true);
    await expect(storage.getSessionId()).resolves.toBe('session-current');
    await expect(storage.getAllSessions()).resolves.toEqual([
      {
        url: CURRENT_URL,
        sessionId: 'session-current',
        createdAt: '2024-01-02T03:04:05.000Z',
      },
    ]);
    await expect(storage.getOtherSessionUrls()).resolves.toEqual([]);

    const otherData = {
      version: 2,
      sessions: {
        [CURRENT_URL]: {
          sessionId: 'session-current',
          createdAt: '2024-01-02T03:04:05.000Z',
          deviceName: 'test-host (darwin)',
          cliVersion: '1.2.3',
        },
        [OTHER_URL]: {
          sessionId: 'session-other',
          createdAt: '2024-01-02T05:06:07.000Z',
        },
      },
    };
    writeFileSync(
      authPath,
      `// Chatroom CLI Authentication\n${JSON.stringify(otherData, null, 2)}\n`,
      'utf-8'
    );

    await expect(storage.getOtherSessionUrls()).resolves.toEqual([OTHER_URL]);

    await expect(storage.clearAuthData()).resolves.toBe(true);
    await expect(storage.loadAuthData()).resolves.toBeNull();
  });

  it('loads legacy auth data only for production and migrates it on save', async () => {
    const storage = await loadStorage();

    const legacyAuthPath = storage.getAuthFilePath();
    mkdirSync(join(testHome, '.chatroom'), { recursive: true });
    writeFileSync(
      legacyAuthPath,
      `// Chatroom CLI Authentication\n${JSON.stringify({
        sessionId: 'legacy-session',
        createdAt: '2023-11-22T10:11:12.000Z',
        deviceName: 'legacy-host (linux)',
      }, null, 2)}\n`,
      'utf-8'
    );

    await expect(storage.loadAuthData()).resolves.toBeNull();

    vi.mocked(getConvexUrl).mockReturnValue(PRODUCTION_URL);
    const productionStorage = await loadStorage();

    await expect(productionStorage.loadAuthData()).resolves.toEqual({
      sessionId: 'legacy-session',
      createdAt: '2023-11-22T10:11:12.000Z',
      deviceName: 'legacy-host (linux)',
    });

    await productionStorage.saveAuthData({
      sessionId: 'production-session' as never,
      createdAt: '2024-02-03T04:05:06.000Z',
    });

    const saved = readFileSync(legacyAuthPath, 'utf-8');
    expect(saved).toContain('"version": 2');
    expect(saved).toContain(PRODUCTION_URL);
    expect(saved).toContain('production-session');
  });

  it('warns and returns null when the auth file is corrupted', async () => {
    const storage = await loadStorage();
    mkdirSync(join(testHome, '.chatroom'), { recursive: true });
    writeFileSync(storage.getAuthFilePath(), '// Chatroom CLI Authentication\n{ not-json }\n', 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(storage.loadAuthData()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read auth file at')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('If this is unexpected, check the file for corruption.')
    );
  });

  it('returns a formatted device name', async () => {
    const storage = await loadStorage();
    await expect(storage.getDeviceName()).resolves.toMatch(/^.+ \(.+\)$/);
  });
});
