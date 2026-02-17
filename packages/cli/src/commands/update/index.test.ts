/**
 * update Unit Tests
 *
 * Tests the update command using injected dependencies.
 * Covers: auth test (exits 1 - npm not available), success test, error test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateDeps } from './deps.js';
import { update } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<UpdateDeps>): UpdateDeps {
  return {
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    exec: vi.fn().mockResolvedValue({ stdout: '2.0.0', stderr: '' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;
let logSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('update', () => {
  describe('authentication / preconditions', () => {
    it('exits with code 1 when npm is not available', async () => {
      const deps = createMockDeps({
        exec: vi.fn().mockRejectedValue(new Error('npm not found')),
      });

      await update(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('npm is not available');
    });

    it('exits with code 1 when cannot check latest version', async () => {
      const deps = createMockDeps({
        exec: vi
          .fn()
          .mockResolvedValueOnce({ stdout: '9.0.0', stderr: '' }) // npm --version
          .mockRejectedValueOnce(new Error('Network error')), // npm view
      });

      await update(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Could not check for latest version');
    });
  });

  describe('success', () => {
    it('reports already on latest version', async () => {
      const deps = createMockDeps({
        getVersion: vi.fn().mockReturnValue('2.0.0'),
        exec: vi.fn().mockResolvedValue({ stdout: '2.0.0', stderr: '' }),
      });

      await update(deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('You already have the latest version');
    });

    it('runs update and reports success', async () => {
      const deps = createMockDeps({
        getVersion: vi.fn().mockReturnValue('1.0.0'),
        exec: vi
          .fn()
          .mockResolvedValueOnce({ stdout: '9.0.0', stderr: '' }) // npm --version
          .mockResolvedValueOnce({ stdout: '2.0.0', stderr: '' }) // npm view
          .mockResolvedValueOnce({ stdout: 'installed', stderr: '' }), // npm install
      });

      await update(deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('Successfully updated chatroom-cli');
      expect(getAllLogOutput()).toContain('1.0.0');
      expect(getAllLogOutput()).toContain('2.0.0');
      expect(deps.exec).toHaveBeenCalledWith('npm install -g chatroom-cli@latest');
    });
  });

  describe('error', () => {
    it('exits with code 1 when npm install fails', async () => {
      const deps = createMockDeps({
        exec: vi
          .fn()
          .mockResolvedValueOnce({ stdout: '9.0.0', stderr: '' }) // npm --version
          .mockResolvedValueOnce({ stdout: '2.0.0', stderr: '' }) // npm view
          .mockRejectedValueOnce(new Error('EACCES: permission denied')), // npm install
      });

      await update(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Update failed');
      expect(getAllErrorOutput()).toContain('permission denied');
      expect(getAllErrorOutput()).toContain('sudo npm install');
    });
  });
});
