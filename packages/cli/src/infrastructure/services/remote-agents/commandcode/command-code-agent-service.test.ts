import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSpawnPrompt } from '../spawn-prompt.js';
import {
  CommandCodeAgentService,
  type CommandCodeAgentServiceDeps,
} from './command-code-agent-service.js';

function createMockDeps(
  overrides?: Partial<CommandCodeAgentServiceDeps>
): CommandCodeAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

describe('CommandCodeAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when cmd command exists', async () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new CommandCodeAgentService(deps);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when cmd command is missing', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which cmd') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new CommandCodeAgentService(deps);
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses semantic version from cmd --version output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.2.3')),
      });
      const service = new CommandCodeAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '1.2.3', major: 1 });
    });

    it('parses version without v prefix', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('2.0.0')),
      });
      const service = new CommandCodeAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '2.0.0', major: 2 });
    });

    it('returns null when version cannot be parsed', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown')),
      });
      const service = new CommandCodeAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });

    it('returns null when command fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new CommandCodeAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns commandcode models including deepseek-v4-flash and claude-sonnet-4-6', async () => {
      const service = new CommandCodeAgentService(createMockDeps());
      const models = await service.listModels();
      expect(models.length).toBeGreaterThan(2);
      expect(models).toContain('deepseek/deepseek-v4-flash');
      expect(models).toContain('claude-sonnet-4-6');
    });
  });

  describe('isAlive', () => {
    it('returns true when process is alive', () => {
      const deps = createMockDeps({ kill: vi.fn() });
      const service = new CommandCodeAgentService(deps);
      expect(service.isAlive(1234)).toBe(true);
      expect(deps.kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns false when process is dead', () => {
      const deps = createMockDeps({
        kill: vi.fn(() => {
          throw new Error('ESRCH');
        }),
      });
      const service = new CommandCodeAgentService(deps);
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
      const service = new CommandCodeAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });

    it('returns immediately if process is already dead', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const service = new CommandCodeAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('spawn', () => {
    it('spawns process with correct arguments including model', async () => {
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

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new CommandCodeAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/test',
        prompt: createSpawnPrompt('Hello agent'),
        systemPrompt: 'You are a test agent',
        model: 'deepseek/deepseek-v4-flash',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'cmd',
        [
          '-p',
          '--skip-onboarding',
          '--yolo',
          '--max-turns',
          '999999',
          '--model',
          'deepseek/deepseek-v4-flash',
        ],
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
      expect(typeof result.onAgentEnd).toBe('function');
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
      const service = new CommandCodeAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        prompt: createSpawnPrompt('test'),
        systemPrompt: 'test system prompt',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'cmd',
        ['-p', '--skip-onboarding', '--yolo', '--max-turns', '999999'],
        expect.any(Object)
      );
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
      const service = new CommandCodeAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp',
          prompt: createSpawnPrompt('test'),
          systemPrompt: 'test system prompt',
          context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
        })
      ).rejects.toThrow('exited immediately');
    });

    it('uses only prompt when systemPrompt is empty', async () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockStdout = new Readable({ read() {} });
      const mockStderr = new Readable({ read() {} });

      const mockChild = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 50,
        killed: false,
        exitCode: null,
      });

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new CommandCodeAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        prompt: createSpawnPrompt('just the prompt'),
        systemPrompt: '',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
      });

      expect(mockStdin.write).toHaveBeenCalledWith('just the prompt');
    });
  });
});
