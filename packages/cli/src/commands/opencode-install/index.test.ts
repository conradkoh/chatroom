/**
 * opencode-install Unit Tests
 *
 * Tests the opencode-install command using injected dependencies.
 * Covers: tools already exist, chatroom not installed, success path, error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenCodeInstallDeps } from './deps.js';
import { installTool } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules (for os.homedir and path.join used in installTool)
// ---------------------------------------------------------------------------

vi.mock('os', () => ({
  homedir: () => '/home/user',
}));

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<OpenCodeInstallDeps>): OpenCodeInstallDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    fs: {
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    isChatroomInstalled: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let logSpy: any;
let errorSpy: any;

beforeEach(() => {
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

describe('installTool', () => {
  describe('tools already exist', () => {
    it('returns failure when tools exist and checkExisting is true', async () => {
      const deps = createMockDeps({
        fs: {
          access: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockResolvedValue(undefined),
        },
      });

      const result = await installTool({ checkExisting: true }, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Tools already exist');
      expect(result.message).toContain('chatroom.ts');
      expect(getAllLogOutput()).toContain('Tools already exist');
    });
  });

  describe('chatroom not installed', () => {
    it('returns failure when chatroom CLI is not installed', async () => {
      const deps = createMockDeps({
        isChatroomInstalled: vi.fn().mockResolvedValue(false),
      });

      const result = await installTool({ checkExisting: true }, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Chatroom CLI is not installed');
      expect(getAllLogOutput()).toContain('Chatroom CLI is not installed');
    });
  });

  describe('success path', () => {
    it('writes tool files and returns success', async () => {
      const deps = createMockDeps();

      const result = await installTool({ checkExisting: true }, deps);

      expect(result.success).toBe(true);
      expect(result.toolPath).toBeDefined();
      expect(result.message).toContain('Installed chatroom OpenCode tools successfully');

      expect(deps.fs.mkdir).toHaveBeenCalled();
      expect(deps.fs.writeFile).toHaveBeenCalledTimes(2);

      const output = getAllLogOutput();
      expect(output).toContain('Installed chatroom OpenCode tools successfully');
      expect(output).toContain('chatroom.ts');
      expect(output).toContain('chatroom-handoff.ts');
    });
  });

  describe('error handling', () => {
    it('returns failure when fs.writeFile throws', async () => {
      const deps = createMockDeps({
        fs: {
          access: vi.fn().mockRejectedValue(new Error('ENOENT')),
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        isChatroomInstalled: vi.fn().mockResolvedValue(true),
      });

      const result = await installTool({ checkExisting: true }, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error installing OpenCode tool');
      expect(result.message).toContain('Permission denied');
      expect(getAllErrorOutput()).toContain('Error installing OpenCode tool');
    });
  });
});
