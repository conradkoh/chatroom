import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  OpenCodeSdkAgentService,
  type OpenCodeSdkAgentServiceDeps,
} from './opencode-sdk-agent-service.js';
import { InMemorySessionMetadataStore } from './session-metadata-store.js';

function createMockDeps(
  overrides?: Partial<OpenCodeSdkAgentServiceDeps>
): OpenCodeSdkAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    sessionMetadataStore: new InMemorySessionMetadataStore(),
    ...overrides,
  };
}

const sharedAbortFn = vi.fn();
const sharedConfigUpdateFn = vi.fn();
const sharedCreateFn = vi.fn();
const sharedPromptAsyncFn = vi.fn();
const sharedEventSubscribeFn = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: sharedCreateFn,
      promptAsync: sharedPromptAsyncFn,
      abort: sharedAbortFn,
    },
    config: { update: sharedConfigUpdateFn },
    event: { subscribe: sharedEventSubscribeFn },
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
    configUpdateThrows: Error;
    promptAsyncThrows: Error;
    subscribeStream: AsyncGenerator<unknown>;
  }>
) {
  sharedCreateFn.mockReset();
  sharedConfigUpdateFn.mockReset();
  sharedPromptAsyncFn.mockReset();
  sharedAbortFn.mockReset();
  sharedEventSubscribeFn.mockReset();

  sharedCreateFn.mockImplementation(
    overrides?.sessionCreateThrows
      ? () => Promise.reject(overrides.sessionCreateThrows)
      : () => Promise.resolve(overrides?.sessionCreateResult ?? { data: { id: 'sess-1' } })
  );
  sharedConfigUpdateFn.mockImplementation(
    overrides?.configUpdateThrows
      ? () => Promise.reject(overrides.configUpdateThrows)
      : () => Promise.resolve({ data: {} })
  );
  sharedPromptAsyncFn.mockImplementation(
    overrides?.promptAsyncThrows
      ? () => Promise.reject(overrides.promptAsyncThrows)
      : () => Promise.resolve({ data: {} })
  );
  sharedAbortFn.mockResolvedValue({});
  sharedEventSubscribeFn.mockResolvedValue({
    stream:
      overrides?.subscribeStream ??
      (async function* () {
        await new Promise(() => {});
      })(),
  });
  return {
    create: sharedCreateFn,
    configUpdate: sharedConfigUpdateFn,
    promptAsync: sharedPromptAsyncFn,
  };
}

function stubSdkClientForStop(overrides?: { abortThrows?: Error }) {
  sharedAbortFn.mockImplementation(
    overrides?.abortThrows ? () => Promise.reject(overrides.abortThrows) : () => Promise.resolve({})
  );
  return { abort: sharedAbortFn };
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };

function spawnOptions(
  overrides?: { model?: string; systemPrompt?: string; prompt?: string },
  contextOverride?: { role?: string }
) {
  return {
    workingDir: '/tmp/test',
    prompt: overrides?.prompt ?? 'do the thing',
    systemPrompt: overrides?.systemPrompt ?? 'you are a helpful builder',
    model: overrides?.model,
    context: { ...SPAWN_CONTEXT, ...contextOverride },
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
    beforeEach(() => {
      vi.mocked(createOpencodeClient).mockReset();
      vi.mocked(createOpencodeClient).mockImplementation(
        () =>
          ({
            session: {
              create: sharedCreateFn,
              promptAsync: sharedPromptAsyncFn,
              abort: sharedAbortFn,
            },
          }) as unknown as ReturnType<typeof createOpencodeClient>
      );
      sharedAbortFn.mockReset();
      sharedAbortFn.mockImplementation(() => Promise.resolve({}));
    });

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

    it('calls session.abort with the correct sessionId before SIGTERM', async () => {
      const store = new InMemorySessionMetadataStore();
      store.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        pid: 4321,
        createdAt: new Date().toISOString(),
        baseUrl: 'http://127.0.0.1:5678',
      });

      const kill = vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('ESRCH');
        });
      const deps = createMockDeps({ kill, sessionMetadataStore: store });
      const service = new OpenCodeSdkAgentService(deps);

      const { abort } = stubSdkClientForStop();

      await service.stop(4321);

      expect(abort).toHaveBeenCalledTimes(1);
      expect(abort).toHaveBeenCalledWith({ path: { id: 'sess-1' } });
      expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(abort.mock.invocationCallOrder[0]).toBeLessThan(kill.mock.invocationCallOrder[0]);
    });

    it('proceeds with SIGTERM even if session.abort throws', async () => {
      const store = new InMemorySessionMetadataStore();
      store.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        pid: 4321,
        createdAt: new Date().toISOString(),
        baseUrl: 'http://127.0.0.1:5678',
      });

      const kill = vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('ESRCH');
        });
      const deps = createMockDeps({ kill, sessionMetadataStore: store });
      const service = new OpenCodeSdkAgentService(deps);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubSdkClientForStop({ abortThrows: new Error('connection refused') });

      await expect(service.stop(4321)).resolves.toBeUndefined();
      expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('proceeds with SIGTERM when no session metadata exists for the pid', async () => {
      const kill = vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('ESRCH');
        });
      const deps = createMockDeps({ kill });
      const service = new OpenCodeSdkAgentService(deps);

      await service.stop(9999);

      expect(vi.mocked(createOpencodeClient)).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(-9999, 'SIGTERM');
    });
  });

  describe('spawn lifecycle', () => {
    beforeEach(() => {
      vi.mocked(createOpencodeClient).mockReset();
    });

    it('happy path: spawns serve, parses URL, creates session, sends promptAsync with built-in agent', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: 'anthropic/claude-sonnet-4', systemPrompt: 'sys', prompt: 'hello' })
      );
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );

      const result = await spawnPromise;

      expect(result.pid).toBe(4321);
      expect(deps.spawn).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--print-logs'],
        expect.objectContaining({ cwd: '/tmp/test', detached: true })
      );

      expect(sdk.configUpdate).not.toHaveBeenCalled();

      expect(sdk.create).toHaveBeenCalledTimes(1);
      expect(sdk.promptAsync).toHaveBeenCalledTimes(1);
      const promptCall = sdk.promptAsync.mock.calls[0][0];
      expect(promptCall.path.id).toBe('sess-1');

      expect(promptCall.body.agent).toBe('build');
      expect(promptCall.body.system).toBe('sys');
      expect(promptCall.body.parts).toEqual([{ type: 'text', text: 'hello' }]);
      expect(promptCall.body.model).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4',
      });
    });

    it('uses built-in "plan" agent for planner role', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ prompt: 'hello', systemPrompt: 'plan only' }, { role: 'planner' })
      );
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.agent).toBe('plan');
    });

    it('omits system field when systemPrompt is empty', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ prompt: 'hello', systemPrompt: '' }));
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.system).toBeUndefined();
    });

    it('omits system field when systemPrompt is whitespace only', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ prompt: 'hello', systemPrompt: '   \n\t  ' })
      );
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.system).toBeUndefined();
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
        expect((err as Error).message).toMatch(
          /did not print a listening URL|opencode server listening/
        );
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects immediately when serve exits during URL parse (not at 10s timeout)', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        stubSdkClient();
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        const settled = spawnPromise.catch((e) => e);
        // Serve exits before printing URL
        child.emit('exit', 1, null);
        await vi.advanceTimersByTimeAsync(100); // well before 10s timeout

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/exited unexpectedly/);
        expect((err as Error).message).toMatch(/code=1/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores unrelated URLs in serve output and uses the correct listening line', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      // Unrelated URL before the listening line
      child.stdout.emit(
        'data',
        Buffer.from('upgrade available at https://opencode.ai/releases/v1.0\n')
      );
      // Real listening line
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      // Verify createOpencodeClient was called with the CORRECT URL (127.0.0.1), not the unrelated one
      expect(vi.mocked(createOpencodeClient)).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://127.0.0.1:5678' })
      );
    });

    it('strips trailing punctuation (period) from captured URL', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      // Trailing period - should NOT be captured
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678.\n')
      );
      await spawnPromise;

      // Verify the URL does NOT include the trailing period
      expect(vi.mocked(createOpencodeClient)).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://127.0.0.1:5678' })
      );
    });

    it('kills the serve child when promptAsync rejects', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ promptAsyncThrows: new Error('provider auth failed') });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow(/provider auth failed/);
      expect(child.kill).toHaveBeenCalled();
    });

    it('kills the serve child when session.create times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        const sdk = stubSdkClient();
        // Make session.create hang forever
        sdk.create.mockImplementation(() => new Promise(() => {}));
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(31_000); // past 30s timeout

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/session\.create.*timed out/i);
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('kills the serve child when promptAsync times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        const sdk = stubSdkClient();
        // Make promptAsync hang forever
        sdk.promptAsync.mockImplementation(() => new Promise(() => {}));
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(61_000); // past 60s timeout

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/session\.promptAsync.*timed out/i);
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
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow(/Failed to create session/);
      expect(child.kill).toHaveBeenCalled();
    });

    it('onExit forwards code/signal/context when the serve child exits', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
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
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      const onOutput = vi.fn();
      result.onOutput(onOutput);
      child.stdout.emit('data', Buffer.from('chunk-1'));
      child.stderr.emit('data', Buffer.from('chunk-2'));

      expect(onOutput).toHaveBeenCalledTimes(2);
    });

    it('forwards model slug with a single slash as {providerID, modelID}', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ model: 'github-copilot/gpt-4o' }));
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.model).toEqual({
        providerID: 'github-copilot',
        modelID: 'gpt-4o',
      });
    });

    it('forwards model slug with a multi-segment modelID (split on first slash only)', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: 'anthropic/claude-sonnet-4.5/thinking' })
      );
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.model).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4.5/thinking',
      });
    });

    it('omits the model field when no model is selected (lets opencode default apply)', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ model: undefined }));
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.model).toBeUndefined();
    });

    it('omits the model field when the slug has no provider prefix (malformed input)', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ model: 'no-slash-here' }));
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.promptAsync.mock.calls[0][0].body.model).toBeUndefined();
    });

    it('filters out INFO-prefixed lines from forwarded serve output, keeps the rest', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const spawnPromise = service.spawn(spawnOptions());
        child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
        await spawnPromise;

        child.stdout.emit(
          'data',
          Buffer.from(
            'INFO  2026-04-25T04:13:56 service=bus type=file.watcher.updated publishing\n'
          )
        );
        child.stderr.emit(
          'data',
          Buffer.from('WARN  2026-04-25T04:13:57 service=foo something interesting\n')
        );

        const allWrites = [
          ...stdoutWriteSpy.mock.calls.map((c) => String(c[0])),
          ...stderrWriteSpy.mock.calls.map((c) => String(c[0])),
        ];

        expect(allWrites.some((w) => w.includes('file.watcher.updated'))).toBe(false);
        expect(allWrites.some((w) => w.includes('something interesting'))).toBe(true);
      } finally {
        stdoutWriteSpy.mockRestore();
        stderrWriteSpy.mockRestore();
      }
    });
  });

  describe('session event forwarder', () => {
    it('C-E1: spawn happy path calls event.subscribe once after session.create', async () => {
      const child = makeFakeChild(9001);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sharedEventSubscribeFn).toHaveBeenCalledTimes(1);
      expect(sharedCreateFn.mock.invocationCallOrder[0]).toBeLessThan(
        sharedEventSubscribeFn.mock.invocationCallOrder[0]
      );
    });

    it('C-E2: stop(pid) clears forwarders map after stopping the stream', async () => {
      const child = makeFakeChild(9002);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({
        subscribeStream: (async function* () {
          yield {
            type: 'session.status',
            properties: { message: 'started' },
          };
          await new Promise(() => {});
        })(),
      });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      await service.stop(result.pid);

      expect(sharedAbortFn).toHaveBeenCalled();
    }, 10000);

    it('C-E3: session.create rejection path never starts the forwarder', async () => {
      const child = makeFakeChild(9003);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ sessionCreateThrows: new Error('create failed') });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow('create failed');
      expect(sharedEventSubscribeFn).not.toHaveBeenCalled();
    });

    it('C-E4: promptAsync rejection stops the forwarder before rethrowing', async () => {
      const child = makeFakeChild(9004);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({
        promptAsyncThrows: new Error('prompt failed'),
        subscribeStream: (async function* () {
          yield {
            type: 'session.status',
            properties: { message: 'started' },
          };
          await new Promise(() => {});
        })(),
      });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow('prompt failed');
      expect(sharedEventSubscribeFn).toHaveBeenCalledTimes(1);
    });
  });
});
