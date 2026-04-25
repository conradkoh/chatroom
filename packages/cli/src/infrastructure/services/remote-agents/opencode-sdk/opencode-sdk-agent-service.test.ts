import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

// ---------------------------------------------------------------------------
// Spawn lifecycle helpers
// ---------------------------------------------------------------------------

import { createOpencodeClient } from '@opencode-ai/sdk';

/** Build a fake child process with EventEmitter-backed stdout/stderr/exit. */
function makeFakeChild(pid = 4321) {
  const stdout = new EventEmitter() as EventEmitter & {
    removeListener: typeof EventEmitter.prototype.removeListener;
    pipe: ReturnType<typeof vi.fn>;
  };
  stdout.pipe = vi.fn();
  const stderr = new EventEmitter() as EventEmitter & {
    removeListener: typeof EventEmitter.prototype.removeListener;
    pipe: ReturnType<typeof vi.fn>;
  };
  stderr.pipe = vi.fn();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();
  return child;
}

function stubSdkClient(
  overrides?: Partial<{
    sessionCreateResult: { data?: { id?: string } };
    sessionCreateThrows: Error;
    promptAsyncThrows: Error;
  }>
) {
  const create = overrides?.sessionCreateThrows
    ? vi.fn().mockRejectedValue(overrides.sessionCreateThrows)
    : vi.fn().mockResolvedValue(
        overrides?.sessionCreateResult ?? { data: { id: 'sess-1' } }
      );
  const promptAsync = overrides?.promptAsyncThrows
    ? vi.fn().mockRejectedValue(overrides.promptAsyncThrows)
    : vi.fn().mockResolvedValue({ data: {} });
  vi.mocked(createOpencodeClient).mockReturnValueOnce({
    session: { create, promptAsync },
  } as unknown as ReturnType<typeof createOpencodeClient>);
  return { create, promptAsync };
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };

function spawnOptions(overrides?: { model?: string; systemPrompt?: string; prompt?: string }) {
  return {
    workingDir: '/tmp/test',
    prompt: overrides?.prompt ?? 'do the thing',
    systemPrompt: overrides?.systemPrompt ?? 'you are a helpful builder',
    model: overrides?.model,
    context: SPAWN_CONTEXT,
  };
}

describe('OpenCodeSdkAgentService', () => {
  describe('isInstalled', () => {
    it('returns true when the opencode CLI is on PATH (SDK is bundled, no runtime resolve)', () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new OpenCodeSdkAgentService(deps);
      expect(service.isInstalled()).toBe(true);
    });

    it('returns false when opencode command is missing', () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
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

  describe('spawn lifecycle', () => {
    beforeEach(() => {
      vi.mocked(createOpencodeClient).mockReset();
    });

    it('happy path: spawns serve, parses URL, creates session, sends promptAsync with system+prompt+agent', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: 'anthropic/claude-sonnet-4', systemPrompt: 'sys', prompt: 'hello' })
      );
      // Simulate the serve printing its URL on stdout.
      child.stdout.emit('data', Buffer.from('opencode server listening at http://127.0.0.1:5678\n'));

      const result = await spawnPromise;

      expect(result.pid).toBe(4321);
      expect(deps.spawn).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--print-logs'],
        expect.objectContaining({ cwd: '/tmp/test', detached: true })
      );
      expect(sdk.create).toHaveBeenCalledTimes(1);
      expect(sdk.promptAsync).toHaveBeenCalledTimes(1);
      const promptCall = sdk.promptAsync.mock.calls[0][0];
      expect(promptCall.path.id).toBe('sess-1');
      expect(promptCall.body.system).toBe('sys');
      expect(promptCall.body.parts).toEqual([{ type: 'text', text: 'hello' }]);
      expect(promptCall.body.agent).toBe('build');
      expect(promptCall.body.model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' });
    });

    it('rejects with timeout error when serve never prints a URL, and kills the child', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        stubSdkClient();
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        // Suppress unhandled-rejection during fake-timer advance.
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(11_000);

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/did not print a listening URL/);
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects and kills the child when session.create returns no id', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ sessionCreateResult: { data: { id: undefined } } });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('listening at http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow(/Failed to create session/);
      expect(child.kill).toHaveBeenCalled();
    });

    it('onExit forwards code/signal/context when the serve child exits', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('listening at http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      const onExit = vi.fn();
      result.onExit(onExit);
      child.emit('exit', 0, null);

      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null, context: SPAWN_CONTEXT });
    });

    it('onOutput fires for each stdout/stderr chunk after spawn settles', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('listening at http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      const onOutput = vi.fn();
      result.onOutput(onOutput);
      child.stdout.emit('data', Buffer.from('chunk-1'));
      child.stderr.emit('data', Buffer.from('chunk-2'));

      expect(onOutput).toHaveBeenCalledTimes(2);
    });
  });
});
