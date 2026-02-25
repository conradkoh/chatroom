import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { PiAgentService, type PiAgentServiceDeps } from './pi-agent-service.js';

function createMockDeps(overrides?: Partial<PiAgentServiceDeps>): PiAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

describe('PiAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when pi command exists', () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new PiAgentService(deps);
      expect(service.isInstalled()).toBe(true);
    });

    it('returns false when pi command is missing', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('not found');
        }),
      });
      const service = new PiAgentService(deps);
      expect(service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses version 0.55.0 correctly', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new PiAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '0.55.0', major: 0 });
    });

    it('parses version with v prefix', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.2.3')),
      });
      const service = new PiAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '1.2.3', major: 1 });
    });

    it('returns null for garbage output', () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('not a version')),
      });
      const service = new PiAgentService(deps);
      expect(service.getVersion()).toBeNull();
    });

    it('returns null when command fails', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new PiAgentService(deps);
      expect(service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('skips the header row (no "provider/model" entry in output)', async () => {
      const tableOutput = [
        'provider  model              context  max-out  thinking  images',
        'anthropic claude-3-5-sonnet  200000   8192     false     true',
        'openai    gpt-4o             128000   4096     false     true',
      ].join('\n');

      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from(tableOutput)),
      });
      const service = new PiAgentService(deps);
      const models = await service.listModels();

      // Header row should be excluded
      expect(models).not.toContain('provider/model');
      // Real models should be included
      expect(models).toContain('anthropic/claude-3-5-sonnet');
      expect(models).toContain('openai/gpt-4o');
    });

    it('formats models as "provider/model"', async () => {
      const tableOutput = [
        'provider  model              context  max-out  thinking  images',
        'anthropic claude-3-5-sonnet  200000   8192     false     true',
        'openai    gpt-4o             128000   4096     false     true',
      ].join('\n');

      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from(tableOutput)),
      });
      const service = new PiAgentService(deps);
      const models = await service.listModels();

      expect(models).toEqual(['anthropic/claude-3-5-sonnet', 'openai/gpt-4o']);
    });

    it('returns empty array when output is empty', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('')),
      });
      const service = new PiAgentService(deps);
      expect(await service.listModels()).toEqual([]);
    });

    it('returns empty array when command fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const service = new PiAgentService(deps);
      expect(await service.listModels()).toEqual([]);
    });

    it('skips lines starting with # or -', async () => {
      const tableOutput = [
        '# comment line',
        '---separator---',
        'provider  model  context',
        'anthropic claude-3-opus  100000',
      ].join('\n');

      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from(tableOutput)),
      });
      const service = new PiAgentService(deps);
      const models = await service.listModels();
      expect(models).toEqual(['anthropic/claude-3-opus']);
    });
  });

  describe('spawn', () => {
    function makeChildProcess(pid: number) {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockStdout = new Readable({ read() {} });
      const mockStderr = new Readable({ read() {} });

      mockStdout.pipe = vi.fn().mockReturnValue(mockStdout);
      mockStderr.pipe = vi.fn().mockReturnValue(mockStderr);

      const child = Object.assign(new EventEmitter(), {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid,
        killed: false,
        exitCode: null,
      });

      return child;
    }

    it('builds the correct shell command with --system-prompt and positional prompt', async () => {
      const child = makeChildProcess(42);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/test',
        systemPrompt: 'You are a test agent',
        prompt: 'Hello world',
        context: { machineId: 'machine1', chatroomId: 'room1', role: 'tester' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        "pi -p --no-session --system-prompt 'You are a test agent' 'Hello world'",
        [],
        expect.objectContaining({
          cwd: '/tmp/test',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          detached: true,
        })
      );
    });

    it('shell-escapes single quotes in system prompt and prompt', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: "It's a system prompt",
        prompt: "Don't stop",
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      // Single quotes inside are escaped as '\''
      expect(spawnFn).toHaveBeenCalledWith(
        "pi -p --no-session --system-prompt 'It'\\''s a system prompt' 'Don'\\''t stop'",
        [],
        expect.any(Object)
      );
    });

    it('throws when process exits immediately', async () => {
      const child = Object.assign(new EventEmitter(), {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: null,
        stderr: null,
        pid: 1,
        killed: false,
        exitCode: 1,
      });

      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp',
          systemPrompt: 'test',
          prompt: 'test',
          context: { machineId: 'm', chatroomId: 'c', role: 'r' },
        })
      ).rejects.toThrow('exited immediately');
    });

    it('returns pid and lifecycle callbacks on success', async () => {
      const child = makeChildProcess(99);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: 'prompt',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      expect(result.pid).toBe(99);
      expect(typeof result.onExit).toBe('function');
      expect(typeof result.onOutput).toBe('function');
    });
  });
});
