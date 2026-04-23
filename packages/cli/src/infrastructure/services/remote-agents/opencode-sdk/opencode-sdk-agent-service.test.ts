import { describe, expect, it, vi } from 'vitest';

import {
  OpenCodeSdkAgentService,
  type OpenCodeSdkAgentServiceDeps,
} from './opencode-sdk-agent-service.js';

function createMockDeps(
  overrides?: Partial<OpenCodeSdkAgentServiceDeps>
): OpenCodeSdkAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    resolveModule: vi.fn(),
    ...overrides,
  };
}

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: vi.fn(),
      promptAsync: vi.fn(),
    },
  })),
}));

describe('OpenCodeSdkAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when opencode CLI and SDK are available', () => {
      const deps = createMockDeps({
        execSync: vi.fn(),
        resolveModule: vi.fn(() => '/mocked/path'),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isInstalled()).toBe(true);
    });

    it('returns false when opencode command is missing', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('not found');
        }),
        resolveModule: vi.fn(),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isInstalled()).toBe(false);
    });

    it('returns false when SDK module cannot be resolved', () => {
      const deps = createMockDeps({
        execSync: vi.fn(),
        resolveModule: vi.fn(() => {
          throw new Error('not found');
        }),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses semantic version from opencode --version output', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.14.22')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '1.14.22', major: 1 });
    });

    it('parses version without v prefix', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('1.0.3')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '1.0.3', major: 1 });
    });

    it('returns null when version cannot be parsed', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('falls back to CLI when SDK fails', async () => {
      const deps = createMockDeps({
        execSync: vi
          .fn()
          .mockReturnValue(Buffer.from('anthropic/claude-3.5-sonnet\nopenai/gpt-4o\n')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      const models = await service.listModels();
      expect(models).toEqual(['anthropic/claude-3.5-sonnet', 'openai/gpt-4o']);
    });

    it('returns empty array when CLI also fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.listModels()).toEqual([]);
    });
  });

  describe('isAlive', () => {
    it('returns true when process is alive', () => {
      const deps = createMockDeps({ kill: vi.fn() });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isAlive(1234)).toBe(true);
      expect(deps.kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns false when process is dead', () => {
      const deps = createMockDeps({
        kill: vi.fn(() => {
          throw new Error('ESRCH');
        }),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isAlive(1234)).toBe(false);
    });
  });

  describe('stop', () => {
    it('sends SIGTERM to process group then returns when process exits', async () => {
      const kill = vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('ESRCH');
        });

      const deps = createMockDeps({ kill });
      const service = new OpenCodeSdkAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });

    it('returns immediately if process is already dead', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const service = new OpenCodeSdkAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledTimes(1);
    });
  });
});
