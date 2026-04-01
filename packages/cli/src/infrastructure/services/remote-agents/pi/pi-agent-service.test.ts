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

    it('captures version from stderr (Pi CLI writes to stderr)', () => {
      // Pi CLI may write version info to stderr, so checkVersion uses 2>&1
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new PiAgentService(deps);
      expect(service.getVersion()).toEqual({ version: '0.55.0', major: 0 });

      // Verify execSync was called with the 2>&1 redirect
      expect(deps.execSync).toHaveBeenCalledWith(
        'pi --version 2>&1',
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 })
      );
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

    it('captures output from stderr (Pi CLI writes to stderr)', async () => {
      // When Pi CLI writes output to stderr, listModels() should still capture it
      // The 2>&1 shell redirect in the command ensures stderr is merged into stdout
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

      // Verify execSync was called with the 2>&1 redirect
      expect(deps.execSync).toHaveBeenCalledWith(
        'pi --list-models 2>&1',
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(models).toEqual(['anthropic/claude-3-5-sonnet', 'openai/gpt-4o']);
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

    it('builds the correct args array with --mode rpc, --system-prompt, and --model', async () => {
      const child = makeChildProcess(42);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/test',
        systemPrompt: 'You are a test agent',
        prompt: 'Hello world',
        model: 'github-copilot/claude-sonnet-4.6',
        context: { machineId: 'machine1', chatroomId: 'room1', role: 'tester' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'pi',
        [
          '--mode',
          'rpc',
          '--no-session',
          '--model',
          'github-copilot/claude-sonnet-4.6',
          '--system-prompt',
          'You are a test agent',
        ],
        expect.objectContaining({
          cwd: '/tmp/test',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          detached: true,
        })
      );
    });

    it('omits --model flag when model is not specified', async () => {
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

      const args = spawnFn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--model');
    });

    it('passes --thinking flag when thinkingLevel is specified', async () => {
      const child = makeChildProcess(42);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/test',
        systemPrompt: 'You are a test agent',
        prompt: 'Hello world',
        model: 'anthropic/claude-sonnet-4',
        thinkingLevel: 'high',
        context: { machineId: 'machine1', chatroomId: 'room1', role: 'tester' },
      });

      const args = spawnFn.mock.calls[0][1] as string[];
      const thinkingIdx = args.indexOf('--thinking');
      expect(thinkingIdx).toBeGreaterThan(-1);
      expect(args[thinkingIdx + 1]).toBe('high');
    });

    it('omits --thinking flag when thinkingLevel is not specified', async () => {
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

      const args = spawnFn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--thinking');
    });

    it('sends the prompt as a JSON RPC command over stdin', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: "It's a system prompt with 'quotes'",
        prompt: "Don't stop",
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      // The prompt is sent as a JSON RPC command — NOT as a positional CLI arg
      const writeCall = child.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writeCall.trim()) as { type: string; message: string };
      expect(parsed.type).toBe('prompt');
      expect(parsed.message).toBe("Don't stop");
    });

    it('does NOT close stdin after spawn (RPC mode keeps stdin open)', async () => {
      const child = makeChildProcess(42);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/test',
        systemPrompt: 'system',
        prompt: 'prompt',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      expect(child.stdin.end).not.toHaveBeenCalled();
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

    it('returns onAgentEnd in spawn result and wires through to reader', async () => {
      const child = makeChildProcess(100);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: 'prompt',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      // onAgentEnd should be present (stdout was provided via makeChildProcess)
      expect(typeof result.onAgentEnd).toBe('function');

      // Register a callback and fire agent_end from the stream
      const agentEndCb = vi.fn();
      result.onAgentEnd!(agentEndCb);

      // Push an agent_end event through the readable stream
      child.stdout.push('{"type":"agent_end"}\n');
      child.stdout.push(null); // end the stream

      // Give readline time to process the line
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(agentEndCb).toHaveBeenCalledOnce();
    });

    it('uses default trigger message when prompt is empty string', async () => {
      const child = makeChildProcess(55);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'You are an agent',
        prompt: '',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      // The prompt is written to stdin as JSON — it should use the default trigger
      const writeCall = child.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writeCall.trim()) as { type: string; message: string };
      expect(parsed.type).toBe('prompt');
      expect(parsed.message).toBeTruthy();
      expect(parsed.message).not.toBe('');
    });

    it('uses default trigger message when prompt is whitespace only', async () => {
      const child = makeChildProcess(56);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'You are an agent',
        prompt: '   ',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const writeCall = child.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writeCall.trim()) as { type: string; message: string };
      expect(parsed.type).toBe('prompt');
      expect(parsed.message.trim()).toBeTruthy();
    });

    it('passes system prompt as CLI flag (no shell escaping needed)', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: "It's a system prompt with 'quotes'",
        prompt: "Don't stop",
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const args = spawnFn.mock.calls[0][1] as string[];
      // System prompt is still passed as a CLI flag — no shell escaping needed (shell: false)
      expect(args).toContain("It's a system prompt with 'quotes'");
      // Prompt is NOT in args — it goes via stdin
      expect(args).not.toContain("Don't stop");
    });
  });
});
