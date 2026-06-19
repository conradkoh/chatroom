import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createSpawnPrompt } from '../spawn-prompt.js';
import { getPiSessionDir, PiAgentService, type PiAgentServiceDeps } from './pi-agent-service.js';

const SAMPLE_SESSION_ID = '019e86d8-39ec-7ae8-8380-c5ee4c904c99';
const SPAWN_READY_DELAY_MS = 500;

type MockChild = {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: Readable;
};

function resolveWriteCallback(
  encodingOrCb?: unknown,
  maybeCb?: unknown
): ((err?: Error | null) => void) | undefined {
  if (typeof encodingOrCb === 'function') {
    return encodingOrCb as (err?: Error | null) => void;
  }
  if (typeof maybeCb === 'function') {
    return maybeCb as (err?: Error | null) => void;
  }
  return undefined;
}

function wireGetStateOnStdinWrite(child: MockChild): void {
  child.stdin.write = vi.fn((data: string | Buffer, encodingOrCb?: unknown, maybeCb?: unknown) => {
    const cb = resolveWriteCallback(encodingOrCb, maybeCb);
    const text = typeof data === 'string' ? data : data.toString();
    if (text.includes('get_state')) {
      setTimeout(() => {
        child.stdout.push(
          `${JSON.stringify({
            type: 'response',
            command: 'get_state',
            success: true,
            data: { sessionId: SAMPLE_SESSION_ID },
          })}\n`
        );
        cb?.(null);
      }, 0);
      return true;
    }
    cb?.(null);
    return true;
  });
}

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
    it('returns true when pi command exists', async () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new PiAgentService(deps);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when pi command is missing', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which pi') as Error & {
            status?: number;
            stderr?: Buffer;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new PiAgentService(deps);
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses version 0.55.0 correctly', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new PiAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '0.55.0', major: 0 });
    });

    it('parses version with v prefix', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.2.3')),
      });
      const service = new PiAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '1.2.3', major: 1 });
    });

    it('returns null for garbage output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('not a version')),
      });
      const service = new PiAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });

    it('captures version from stderr (Pi CLI writes to stderr)', async () => {
      // Pi CLI may write version info to stderr, so checkVersion uses 2>&1
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('0.55.0')),
      });
      const service = new PiAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '0.55.0', major: 0 });

      // Verify execSync was called with the 2>&1 redirect
      expect(deps.execSync).toHaveBeenCalledWith(
        'pi --version 2>&1',
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 })
      );
    });

    it('returns null when command fails', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('command not found');
        }),
      });
      const service = new PiAgentService(deps);
      expect(await service.getVersion()).toBeNull();
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

    it('returns empty array and warns when command fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const service = new PiAgentService(deps);
      expect(await service.listModels()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toEqual({
        event: 'list-models-error',
        harness: 'pi',
        reason: 'failed',
        attempts: 3,
      });
      warnSpy.mockRestore();
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
    function makeChildProcess(pid: number, options?: { wireGetState?: boolean }) {
      const mockStdin = {
        write: vi.fn((_data: string | Buffer, encodingOrCb?: unknown, maybeCb?: unknown) => {
          resolveWriteCallback(encodingOrCb, maybeCb)?.(null);
          return true;
        }),
        end: vi.fn(),
      };
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

      if (options?.wireGetState !== false) {
        wireGetStateOnStdinWrite(child);
      }

      return child;
    }

    it('builds the correct args array with --mode rpc, --session-dir, --system-prompt, and --model', async () => {
      const child = makeChildProcess(42);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/test',
        systemPrompt: 'You are a test agent',
        prompt: createSpawnPrompt('Hello world'),
        model: 'github-copilot/claude-sonnet-4.6',
        context: { machineId: 'machine1', chatroomId: 'room1', role: 'tester' },
      });

      expect(spawnFn).toHaveBeenCalledWith(
        'pi',
        [
          '--mode',
          'rpc',
          '--session-dir',
          getPiSessionDir('/tmp/test'),
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
        prompt: createSpawnPrompt('Hello world'),
        context: { machineId: 'machine1', chatroomId: 'room1', role: 'tester' },
      });

      const args = spawnFn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--model');
    });

    it('sends the prompt as a JSON RPC command over stdin after get_state', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: "It's a system prompt with 'quotes'",
        prompt: createSpawnPrompt("Don't stop"),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const promptWrites = (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0] as string)
        .filter((line) => line.includes('"prompt"'));
      expect(promptWrites.length).toBeGreaterThanOrEqual(1);
      const lastPrompt = promptWrites.at(-1);
      if (!lastPrompt) throw new Error('expected prompt write');
      const parsed = JSON.parse(lastPrompt.trim()) as { type: string; message: string };
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
        prompt: createSpawnPrompt('prompt'),
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
          prompt: createSpawnPrompt('test'),
          context: { machineId: 'm', chatroomId: 'c', role: 'r' },
        })
      ).rejects.toThrow('exited immediately');
    });

    it('returns pid, harnessSessionId, harnessReconnect, and lifecycle callbacks on success', async () => {
      const child = makeChildProcess(99);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: createSpawnPrompt('prompt'),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      expect(result.pid).toBe(99);
      expect(result.harnessSessionId).toBe(SAMPLE_SESSION_ID);
      expect(result.harnessReconnect).toEqual({ agentName: 'pi' });
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
        prompt: createSpawnPrompt('prompt'),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      // onAgentEnd should be present (stdout was provided via makeChildProcess)
      expect(typeof result.onAgentEnd).toBe('function');

      // Register a callback and fire agent_end from the stream
      const agentEndCb = vi.fn();
      if (!result.onAgentEnd) throw new Error('expected onAgentEnd');
      result.onAgentEnd(agentEndCb);

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
        prompt: createSpawnPrompt(''),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const promptWrites = (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0] as string)
        .filter((line) => line.includes('"prompt"'));
      const lastPrompt = promptWrites.at(-1);
      if (!lastPrompt) throw new Error('expected prompt write');
      const parsed = JSON.parse(lastPrompt.trim()) as { type: string; message: string };
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
        prompt: createSpawnPrompt('   '),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const promptWritesWhitespace = (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0] as string)
        .filter((line) => line.includes('"prompt"'));
      const lastWhitespacePrompt = promptWritesWhitespace.at(-1);
      if (!lastWhitespacePrompt) throw new Error('expected prompt write');
      const parsed = JSON.parse(lastWhitespacePrompt.trim()) as { type: string; message: string };
      expect(parsed.type).toBe('prompt');
      expect(parsed.message.trim()).toBeTruthy();
    });

    it('throws when get_state times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeChildProcess(44, { wireGetState: false });
        const spawnFn = vi.fn().mockReturnValue(child);
        const deps = createMockDeps({ spawn: spawnFn as any });
        const service = new PiAgentService(deps);

        const spawnPromise = service.spawn({
          workingDir: '/tmp',
          systemPrompt: 'system',
          prompt: createSpawnPrompt('prompt'),
          context: { machineId: 'm', chatroomId: 'c', role: 'r' },
        });

        const assertion = expect(spawnPromise).rejects.toThrow('get_state timed out');
        await vi.advanceTimersByTimeAsync(SPAWN_READY_DELAY_MS + 5_000);
        await assertion;
      } finally {
        await vi.runAllTimersAsync();
        vi.useRealTimers();
      }
    });

    it('resumeTurn writes prompt JSON to stdin', async () => {
      const child = makeChildProcess(77);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: createSpawnPrompt('initial'),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const writeWithCallback = vi.fn(
        (_data: string | Buffer, encodingOrCb?: unknown, maybeCb?: unknown) => {
          resolveWriteCallback(encodingOrCb, maybeCb)?.(null);
          return true;
        }
      );
      child.stdin.write = writeWithCallback;
      await service.resumeTurn(77, 'resume message');

      expect(writeWithCallback).toHaveBeenCalledOnce();
      const written = writeWithCallback.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim()) as { type: string; message: string };
      expect(parsed).toEqual({ type: 'prompt', message: 'resume message' });
    });

    it('resumeTurn throws when no tracked process', async () => {
      const service = new PiAgentService(createMockDeps());
      await expect(service.resumeTurn(999, 'prompt')).rejects.toThrow(
        'No tracked pi process or stdin for pid=999'
      );
    });

    it('passes system prompt as CLI flag (no shell escaping needed)', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: "It's a system prompt with 'quotes'",
        prompt: createSpawnPrompt("Don't stop"),
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      const args = spawnFn.mock.calls[0][1] as string[];
      // System prompt is still passed as a CLI flag — no shell escaping needed (shell: false)
      expect(args).toContain("It's a system prompt with 'quotes'");
      // Prompt is NOT in args — it goes via stdin
      expect(args).not.toContain("Don't stop");
    });

    it('logs bash tool calls with "running:" format', async () => {
      const child = makeChildProcess(43);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: createSpawnPrompt('prompt'),
        context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      });

      child.stdout.push(
        JSON.stringify({
          type: 'tool_execution_start',
          toolName: 'bash',
          toolArgs: { command: 'git status' },
        }) + '\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const writtenCalls = stdoutWrite.mock.calls.map((call) => call[0] as string);
      const bashLine = writtenCalls.find((line) => line.includes('tool: bash] running:'));
      expect(bashLine).toBeDefined();
      expect(bashLine).toContain('git status');
      expect(bashLine).toContain('[pi:builder');

      stdoutWrite.mockRestore();
    });

    it('logs shell tool calls with "running:" format', async () => {
      const child = makeChildProcess(44);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: createSpawnPrompt('prompt'),
        context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      });

      child.stdout.push(
        JSON.stringify({
          type: 'tool_execution_start',
          toolName: 'shell',
          toolArgs: { command: 'npm run build' },
        }) + '\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const writtenCalls = stdoutWrite.mock.calls.map((call) => call[0] as string);
      const bashLine = writtenCalls.find((line) => line.includes('tool: bash] running:'));
      expect(bashLine).toBeDefined();
      expect(bashLine).toContain('npm run build');

      stdoutWrite.mockRestore();
    });
  });

  describe('resumeFromDaemonMemory', () => {
    function makeChildProcess(pid: number) {
      const mockStdin = {
        write: vi.fn((_data: string | Buffer, encodingOrCb?: unknown, maybeCb?: unknown) => {
          resolveWriteCallback(encodingOrCb, maybeCb)?.(null);
          return true;
        }),
        end: vi.fn(),
      };
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

      wireGetStateOnStdinWrite(child);
      return child;
    }

    it('spawns with --session and returns stored harnessSessionId', async () => {
      const child = makeChildProcess(88);
      const spawnFn = vi.fn().mockReturnValue(child);
      const deps = createMockDeps({ spawn: spawnFn as any });
      const service = new PiAgentService(deps);

      const result = await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/ws',
          systemPrompt: 'system',
          prompt: createSpawnPrompt('resume prompt'),
          model: 'anthropic/claude-3-5-sonnet',
          context: { machineId: 'm', chatroomId: 'c', role: 'r' },
        },
        {
          harnessSessionId: 'stored-session-id',
          agentName: 'pi',
          workingDir: '/tmp/ws',
        }
      );

      expect(spawnFn).toHaveBeenCalledWith(
        'pi',
        expect.arrayContaining([
          '--session-dir',
          getPiSessionDir('/tmp/ws'),
          '--session',
          'stored-session-id',
        ]),
        expect.any(Object)
      );
      expect(result.harnessSessionId).toBe('stored-session-id');
      expect(result.harnessReconnect).toEqual({
        agentName: 'pi',
        model: 'anthropic/claude-3-5-sonnet',
      });
    });
  });

  describe('getHarnessReconnectContext', () => {
    function makeChildProcess(pid: number) {
      const mockStdin = {
        write: vi.fn((_data: string | Buffer, encodingOrCb?: unknown, maybeCb?: unknown) => {
          resolveWriteCallback(encodingOrCb, maybeCb)?.(null);
          return true;
        }),
        end: vi.fn(),
      };
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
      wireGetStateOnStdinWrite(child);
      return child;
    }

    it('returns agentName pi and model after spawn', async () => {
      const child = makeChildProcess(70);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) as any });
      const service = new PiAgentService(deps);

      await service.spawn({
        workingDir: '/tmp',
        systemPrompt: 'system',
        prompt: createSpawnPrompt('go'),
        model: 'openai/gpt-4o',
        context: { machineId: 'm', chatroomId: 'c', role: 'r' },
      });

      expect(service.getHarnessReconnectContext(70)).toEqual({
        agentName: 'pi',
        model: 'openai/gpt-4o',
      });
    });

    it('returns undefined for unknown pid', () => {
      const service = new PiAgentService(createMockDeps());
      expect(service.getHarnessReconnectContext(404)).toBeUndefined();
    });
  });
});
