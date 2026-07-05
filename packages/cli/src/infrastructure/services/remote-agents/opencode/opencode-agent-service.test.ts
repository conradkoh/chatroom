import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSpawnPrompt } from '../spawn-prompt.js';
import { OpenCodeAgentService, type OpenCodeAgentServiceDeps } from './opencode-agent-service.js';
import { TEST_MODEL_OPENCODE } from '../../../../testing/test-models.js';

function createMockDeps(overrides?: Partial<OpenCodeAgentServiceDeps>): OpenCodeAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

describe('OpenCodeAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when opencode command exists', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when opencode command is missing', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which opencode') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses semantic version from opencode --version output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v0.2.15')),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '0.2.15', major: 0 });
    });

    it('parses version without v prefix', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('1.0.3')),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '1.0.3', major: 1 });
    });

    it('returns null when version cannot be parsed', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown')),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });

    it('returns null when command fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns parsed model list', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from(`${TEST_MODEL_OPENCODE}\nopenai/gpt-4o\n`)),
      });
      const service = new OpenCodeAgentService(deps);
      const models = await service.listModels();
      expect(models).toEqual([TEST_MODEL_OPENCODE, 'openai/gpt-4o']);
    });

    it('returns empty array when output is empty', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('')),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.listModels()).toEqual([]);
    });

    it('returns empty array and warns when command fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.listModels()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toEqual({
        event: 'list-models-error',
        harness: 'opencode',
        reason: 'failed',
        attempts: 3,
      });
      warnSpy.mockRestore();
    });

    it('filters blank lines from output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('model/a\n\n  \nmodel/b\n')),
      });
      const service = new OpenCodeAgentService(deps);
      expect(await service.listModels()).toEqual(['model/a', 'model/b']);
    });
  });

  describe('isAlive', () => {
    it('returns true when process is alive', () => {
      const deps = createMockDeps({ kill: vi.fn() });
      const service = new OpenCodeAgentService(deps);
      expect(service.isAlive(1234)).toBe(true);
      expect(deps.kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns false when process is dead', () => {
      const deps = createMockDeps({
        kill: vi.fn(() => {
          throw new Error('ESRCH');
        }),
      });
      const service = new OpenCodeAgentService(deps);
      expect(service.isAlive(1234)).toBe(false);
    });
  });

  describe('stop', () => {
    it('sends SIGTERM to process group then returns when process exits', async () => {
      const kill = vi
        .fn()
        .mockImplementationOnce(() => {}) // SIGTERM to -pid
        .mockImplementationOnce(() => {
          // kill(pid, 0) check
          throw new Error('ESRCH');
        });

      const deps = createMockDeps({ kill });
      const service = new OpenCodeAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });

    it('returns immediately if process is already dead', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const service = new OpenCodeAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('spawn', () => {
    it('spawns process with correct arguments', async () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockStdout = new Readable({ read() {} });
      const mockStderr = new Readable({ read() {} });

      const mockChild = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 42,
        killed: false,
        exitCode: null,
      });

      // Pipe needs the target to be a writable stream, mock it
      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new OpenCodeAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/test',
        prompt: createSpawnPrompt('Hello agent'),
        systemPrompt: 'You are a test agent',
        model: TEST_MODEL_OPENCODE,
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'opencode',
        ['run', '--model', TEST_MODEL_OPENCODE],
        expect.objectContaining({
          cwd: '/tmp/test',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          detached: true,
        })
      );

      expect(mockStdin.write).toHaveBeenCalledWith('You are a test agent\n\nHello agent');
      expect(mockStdin.end).toHaveBeenCalled();
      expect(result.pid).toBe(42);
      expect(typeof result.onExit).toBe('function');
      expect(typeof result.onOutput).toBe('function');
    });

    it('spawns without --model flag when model is not specified', async () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockStdout = new Readable({ read() {} });
      const mockStderr = new Readable({ read() {} });

      const mockChild = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 99,
        killed: false,
        exitCode: null,
      });

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new OpenCodeAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        prompt: createSpawnPrompt('test'),
        systemPrompt: 'test system prompt',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(spawnFn).toHaveBeenCalledWith('opencode', ['run'], expect.any(Object));
    });

    it('throws when process exits immediately', async () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };

      const mockChild = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: null,
        stderr: null,
        pid: 1,
        killed: false,
        exitCode: 1,
      });

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new OpenCodeAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp',
          prompt: createSpawnPrompt('test'),
          systemPrompt: 'test system prompt',
          context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
          resolvedConvexUrl: 'http://test:3210',
        })
      ).rejects.toThrow('exited immediately');
    });
  });
});
