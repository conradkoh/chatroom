import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSpawnPrompt } from '../spawn-prompt.js';
import { CursorAgentService, type CursorAgentServiceDeps } from './cursor-agent-service.js';

function createMockDeps(overrides?: Partial<CursorAgentServiceDeps>): CursorAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

describe('CursorAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when agent command exists', () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new CursorAgentService(deps);
      expect(service.isInstalled()).toBe(true);
    });

    it('returns false when agent command is missing', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('not found');
        }),
      });
      const service = new CursorAgentService(deps);
      expect(service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses semantic version from agent --version output', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v0.48.7')),
      });
      const service = new CursorAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '0.48.7', major: 0 });
    });

    it('parses version without v prefix', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('1.0.0')),
      });
      const service = new CursorAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '1.0.0', major: 1 });
    });

    it('returns null when version cannot be parsed', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown')),
      });
      const service = new CursorAgentService(deps);
      expect(service.getVersion()).toBeNull();
    });

    it('returns null when command fails', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new CursorAgentService(deps);
      expect(service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns cursor models with claude-4.6-opus-high first (default)', async () => {
      const service = new CursorAgentService(createMockDeps());
      const models = await service.listModels();
      expect(models[0]).toBe('claude-4.6-opus-high');
      expect(models.length).toBeGreaterThan(2);
      expect(models).toContain('gpt-5.4-high');
      expect(models).toContain('claude-4.6-sonnet-medium');
      expect(models).toContain('gemini-3.1-pro');
    });
  });

  describe('isAlive', () => {
    it('returns true when process is alive', () => {
      const deps = createMockDeps({ kill: vi.fn() });
      const service = new CursorAgentService(deps);
      expect(service.isAlive(1234)).toBe(true);
      expect(deps.kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns false when process is dead', () => {
      const deps = createMockDeps({
        kill: vi.fn(() => {
          throw new Error('ESRCH');
        }),
      });
      const service = new CursorAgentService(deps);
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
      const service = new CursorAgentService(deps);
      await service.stop(1234);

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });

    it('returns immediately if process is already dead', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const service = new CursorAgentService(deps);
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

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new CursorAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/test',
        prompt: createSpawnPrompt('Hello agent'),
        systemPrompt: 'You are a test agent',
        model: 'claude-4-sonnet',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'agent',
        ['-p', '--force', '--output-format', 'stream-json', '--model', 'claude-4-sonnet'],
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
      const service = new CursorAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        prompt: createSpawnPrompt('test'),
        systemPrompt: 'test system prompt',
        context: { machineId: 'test-machine', chatroomId: 'test-chatroom', role: 'test-role' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'agent',
        ['-p', '--force', '--output-format', 'stream-json'],
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
      const service = new CursorAgentService(deps);

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
      const service = new CursorAgentService(deps);

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
