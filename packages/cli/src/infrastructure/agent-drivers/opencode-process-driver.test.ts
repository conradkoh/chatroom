import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  OpenCodeProcessDriver,
  type OpenCodeProcessDriverDeps,
} from './opencode-process-driver.js';

function createMockDeps(overrides?: Partial<OpenCodeProcessDriverDeps>): OpenCodeProcessDriverDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

describe('OpenCodeProcessDriver', () => {
  describe('capabilities', () => {
    it('has modelSelection=true and all other capabilities=false', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.capabilities.modelSelection).toBe(true);
      expect(driver.capabilities.sessionPersistence).toBe(false);
      expect(driver.capabilities.abort).toBe(false);
      expect(driver.capabilities.compaction).toBe(false);
      expect(driver.capabilities.eventStreaming).toBe(false);
      expect(driver.capabilities.messageInjection).toBe(false);
      expect(driver.capabilities.dynamicModelDiscovery).toBe(false);
    });

    it('has harness=opencode', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.harness).toBe('opencode');
    });
  });

  describe('buildArgsForService', () => {
    it('builds [run, --model, <model>] when model is provided', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildArgsForService('anthropic/claude-3.5-sonnet')).toEqual([
        'run',
        '--model',
        'anthropic/claude-3.5-sonnet',
      ]);
    });

    it('builds [run] when model is not provided', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildArgsForService()).toEqual(['run']);
    });

    it('builds [run] when model is undefined', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildArgsForService(undefined)).toEqual(['run']);
    });
  });

  describe('buildPromptForService', () => {
    it('prepends systemPrompt with double newline when provided', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildPromptForService('You are an agent', 'Hello')).toBe(
        'You are an agent\n\nHello'
      );
    });

    it('returns just the prompt when systemPrompt is empty string', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildPromptForService('', 'Hello')).toBe('Hello');
    });

    it('returns just the prompt when systemPrompt is undefined', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.buildPromptForService(undefined, 'Hello')).toBe('Hello');
    });
  });

  describe('listModels', () => {
    it('returns parsed model list', async () => {
      const deps = createMockDeps({
        execSync: vi
          .fn()
          .mockReturnValue(Buffer.from('anthropic/claude-3.5-sonnet\nopenai/gpt-4o\n')),
      });
      const driver = new OpenCodeProcessDriver(deps);
      const models = await driver.listModels();
      expect(models).toEqual(['anthropic/claude-3.5-sonnet', 'openai/gpt-4o']);
    });

    it('returns empty array when output is empty', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('')),
      });
      const driver = new OpenCodeProcessDriver(deps);
      expect(await driver.listModels()).toEqual([]);
    });

    it('returns empty array when command fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const driver = new OpenCodeProcessDriver(deps);
      expect(await driver.listModels()).toEqual([]);
    });

    it('filters blank lines from output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('model/a\n\n  \nmodel/b\n')),
      });
      const driver = new OpenCodeProcessDriver(deps);
      expect(await driver.listModels()).toEqual(['model/a', 'model/b']);
    });
  });

  describe('isAlive', () => {
    it('returns true when process is alive', () => {
      const deps = createMockDeps({ kill: vi.fn() });
      const driver = new OpenCodeProcessDriver(deps);
      expect(
        driver.isAlive({ harness: 'opencode', type: 'process', pid: 1234, workingDir: '/tmp' })
      ).toBe(true);
      expect(deps.kill).toHaveBeenCalledWith(1234, 0);
    });

    it('returns false when process is dead', () => {
      const deps = createMockDeps({
        kill: vi.fn(() => {
          throw new Error('ESRCH');
        }),
      });
      const driver = new OpenCodeProcessDriver(deps);
      expect(
        driver.isAlive({ harness: 'opencode', type: 'process', pid: 1234, workingDir: '/tmp' })
      ).toBe(false);
    });

    it('returns false when handle has no pid', () => {
      const driver = new OpenCodeProcessDriver();
      expect(driver.isAlive({ harness: 'opencode', type: 'process', workingDir: '/tmp' })).toBe(
        false
      );
    });
  });

  describe('stop', () => {
    it('sends SIGTERM to process group then returns when process exits', async () => {
      const kill = vi
        .fn()
        .mockImplementationOnce(() => {}) // SIGTERM to -pid
        .mockImplementationOnce(() => {
          throw new Error('ESRCH');
        });

      const deps = createMockDeps({ kill });
      const driver = new OpenCodeProcessDriver(deps);
      await driver.stop({ harness: 'opencode', type: 'process', pid: 1234, workingDir: '/tmp' });

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });

    it('returns immediately if process is already dead', async () => {
      const kill = vi.fn().mockImplementationOnce(() => {
        throw new Error('ESRCH');
      });

      const deps = createMockDeps({ kill });
      const driver = new OpenCodeProcessDriver(deps);
      await driver.stop({ harness: 'opencode', type: 'process', pid: 1234, workingDir: '/tmp' });

      expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('start', () => {
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
      const driver = new OpenCodeProcessDriver(deps);

      const handle = await driver.start({
        workingDir: '/tmp/test',
        initialMessage: 'Hello agent',
        rolePrompt: 'You are a test agent',
        model: 'anthropic/claude-3.5-sonnet',
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'opencode',
        ['run', '--model', 'anthropic/claude-3.5-sonnet'],
        expect.objectContaining({
          cwd: '/tmp/test',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          detached: true,
        })
      );

      expect(mockStdin.write).toHaveBeenCalledWith('You are a test agent\n\nHello agent');
      expect(mockStdin.end).toHaveBeenCalled();
      expect(handle.pid).toBe(42);
      expect(handle.harness).toBe('opencode');
      expect(handle.type).toBe('process');
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
      const driver = new OpenCodeProcessDriver(deps);

      await driver.start({
        workingDir: '/tmp',
        initialMessage: 'test',
        rolePrompt: 'test system prompt',
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
      const driver = new OpenCodeProcessDriver(deps);

      await expect(
        driver.start({
          workingDir: '/tmp',
          initialMessage: 'test',
          rolePrompt: 'test system prompt',
        })
      ).rejects.toThrow('exited immediately');
    });

    it('uses only prompt when rolePrompt is empty', async () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockStdout = new Readable({ read() {} });
      const mockStderr = new Readable({ read() {} });

      const mockChild = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 55,
        killed: false,
        exitCode: null,
      });

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const spawnFn = vi.fn().mockReturnValue(mockChild);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const driver = new OpenCodeProcessDriver(deps);

      await driver.start({
        workingDir: '/tmp',
        initialMessage: 'just the message',
        rolePrompt: '',
      });

      expect(mockStdin.write).toHaveBeenCalledWith('just the message');
    });
  });
});
