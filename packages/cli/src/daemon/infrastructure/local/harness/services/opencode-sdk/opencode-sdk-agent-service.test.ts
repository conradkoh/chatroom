import { EventEmitter } from 'node:events';

import { OpenCode } from '@opencode/client';
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import * as opencodeCatalog from './opencode-model-catalog.js';
import {
  OpenCodeSdkAgentService,
  type OpenCodeSdkAgentServiceDeps,
} from './opencode-sdk-agent-service.js';
import { startSessionEventForwarder as realStartForwarder } from './session-event-forwarder.js';
import { InMemorySessionMetadataStore } from './session-metadata-store.js';
import { TEST_MODEL_OPENCODE } from '../../../../../../testing/test-models.js';
import type { HarnessActivitySignal } from '../../../../../services/agent-process-service/index.js';
import type { SpawnContext } from '../remote-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

// ---------------------------------------------------------------------------
// Spawn lifecycle helpers
// ---------------------------------------------------------------------------

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

const sharedInterruptFn = vi.fn();
const sharedCreateFn = vi.fn();
const sharedGetFn = vi.fn();
const sharedPromptFn = vi.fn();
const sharedSwitchAgentFn = vi.fn();
const sharedSwitchModelFn = vi.fn();
const sharedInstructionPutFn = vi.fn();
const sharedEventSubscribeFn = vi.fn();
const sharedAgentListFn = vi.fn();

/**
 * Construct an opencode AgentInfo fixture for tests. The defaults match the
 * shape returned by `client.agent.list()` while keeping per-test overrides
 * focused on the fields a given test actually cares about (name, mode, system).
 */
function makeAgent(
  name: string,
  mode: 'subagent' | 'primary' | 'all',
  system?: string,
  hidden = false
) {
  return {
    id: name,
    name,
    mode,
    hidden,
    request: {},
    permissions: [],
    ...(system !== undefined ? { system } : {}),
  };
}

const DEFAULT_AGENTS = [
  makeAgent('build', 'primary', 'BUILTIN_BUILD_PROMPT'),
  makeAgent('planner', 'primary', 'BUILTIN_PLANNER_PROMPT'),
  makeAgent('subagent-helper', 'subagent', 'SUBAGENT'),
];

vi.mock('@opencode/client', () => ({
  OpenCode: {
    make: vi.fn(() => ({
      session: {
        create: sharedCreateFn,
        get: sharedGetFn,
        interrupt: sharedInterruptFn,
        prompt: sharedPromptFn,
        switchAgent: sharedSwitchAgentFn,
        switchModel: sharedSwitchModelFn,
        instructions: { entry: { put: sharedInstructionPutFn } },
      },
      agent: { list: sharedAgentListFn },
      event: { subscribe: sharedEventSubscribeFn },
    })),
  },
}));

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

const NEVER_STREAM = () =>
  (async function* () {
    await new Promise(() => {});
  })();

function stubSdkClient(overrides?: {
  sessionCreateResult?: { id?: string | undefined };
  sessionCreateThrows?: Error;
  promptThrows?: Error;
  subscribeStream?: AsyncIterable<unknown>;
}) {
  sharedCreateFn.mockReset();
  sharedGetFn.mockReset();
  sharedPromptFn.mockReset();
  sharedInterruptFn.mockReset();
  sharedSwitchAgentFn.mockReset();
  sharedSwitchModelFn.mockReset();
  sharedInstructionPutFn.mockReset();
  sharedEventSubscribeFn.mockReset();
  sharedAgentListFn.mockReset();

  sharedCreateFn.mockImplementation(
    overrides?.sessionCreateThrows
      ? () => Promise.reject(overrides.sessionCreateThrows)
      : () => Promise.resolve(overrides?.sessionCreateResult ?? { id: 'sess-1' })
  );
  sharedPromptFn.mockImplementation(
    overrides?.promptThrows
      ? () => Promise.reject(overrides.promptThrows)
      : () => Promise.resolve({})
  );
  sharedInterruptFn.mockResolvedValue({});
  sharedSwitchAgentFn.mockResolvedValue(undefined);
  sharedSwitchModelFn.mockResolvedValue(undefined);
  sharedInstructionPutFn.mockResolvedValue(undefined);
  sharedEventSubscribeFn.mockImplementation(() => overrides?.subscribeStream ?? NEVER_STREAM());
  sharedAgentListFn.mockImplementation(() => Promise.resolve({ data: DEFAULT_AGENTS }));

  sharedGetFn.mockResolvedValue({ id: 'sess-1' });

  return {
    create: sharedCreateFn,
    get: sharedGetFn,
    prompt: sharedPromptFn,
    interrupt: sharedInterruptFn,
    instructionPut: sharedInstructionPutFn,
    agentList: sharedAgentListFn,
  };
}

function stubSdkClientForStop(overrides?: { interruptThrows?: Error | undefined }) {
  sharedInterruptFn.mockImplementation(
    overrides?.interruptThrows
      ? () => Promise.reject(overrides.interruptThrows)
      : () => Promise.resolve()
  );
  return { interrupt: sharedInterruptFn };
}

const SPAWN_CONTEXT: SpawnContext = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };

function spawnOptions(
  overrides?: {
    model?: string | undefined;
    systemPrompt?: string | undefined;
    prompt?: string | undefined;
  },
  contextOverride?: Partial<SpawnContext>
) {
  return {
    workingDir: '/tmp/test',
    prompt: createSpawnPrompt(overrides?.prompt ?? 'do the thing'),
    systemPrompt: overrides?.systemPrompt ?? 'you are a helpful builder',
    model: overrides && 'model' in overrides ? overrides.model : TEST_MODEL_OPENCODE,
    context: { ...SPAWN_CONTEXT, ...contextOverride },
    resolvedConvexUrl: 'http://test:3210',
  };
}

describe('OpenCodeSdkAgentService', () => {
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
  });

  describe('isInstalled', () => {
    it('returns true when the opencode CLI is on PATH (SDK is bundled, no runtime resolve)', async () => {
      const deps = createMockDeps({ execSync: vi.fn() });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when opencode command is missing', async () => {
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          const err = new Error('Command failed: which opencode') as Error & {
            status?: number | undefined;
            stderr?: Buffer | undefined;
          };
          err.status = 1;
          err.stderr = Buffer.from('');
          throw err;
        }),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('parses semantic version from opencode --version output', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('v1.14.22')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '1.14.22', major: 1 });
    });

    it('parses version without v prefix', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('1.0.3')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.getVersion()).toEqual({ version: '1.0.3', major: 1 });
    });

    it('returns null when version cannot be parsed', async () => {
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from('unknown')),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.getVersion()).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns provider catalog when fetch succeeds', async () => {
      vi.spyOn(opencodeCatalog, 'fetchOpencodeProviderModelCatalog').mockResolvedValue([
        'opencode-go/gpt-5.6-luna[variant=max]',
      ]);
      const service = new OpenCodeSdkAgentService(createMockDeps());
      expect(await service.listModels()).toEqual(['opencode-go/gpt-5.6-luna[variant=max]']);
    });

    it('falls back to CLI when provider fetch is empty', async () => {
      vi.spyOn(opencodeCatalog, 'fetchOpencodeProviderModelCatalog').mockResolvedValue([]);
      const deps = createMockDeps({
        execSync: vi.fn().mockReturnValue(Buffer.from(`${TEST_MODEL_OPENCODE}\nopenai/gpt-4o\n`)),
      });
      const service = new OpenCodeSdkAgentService(deps);
      const models = await service.listModels();
      expect(models).toEqual([TEST_MODEL_OPENCODE, 'openai/gpt-4o']);
    });

    it('returns empty array and warns when CLI also fails', async () => {
      vi.spyOn(opencodeCatalog, 'fetchOpencodeProviderModelCatalog').mockResolvedValue([]);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = createMockDeps({
        execSync: vi.fn(() => {
          throw new Error('failed');
        }),
      });
      const service = new OpenCodeSdkAgentService(deps);
      expect(await service.listModels()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toEqual({
        event: 'list-models-error',
        harness: 'opencode-sdk',
        reason: 'failed',
        attempts: 3,
      });
      warnSpy.mockRestore();
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
      vi.mocked(OpenCode.make).mockReset();
      vi.mocked(OpenCode.make).mockImplementation(
        () =>
          ({
            session: {
              create: sharedCreateFn,
              prompt: sharedPromptFn,
              interrupt: sharedInterruptFn,
            },
          }) as unknown as ReturnType<typeof OpenCode.make>
      );
      sharedInterruptFn.mockReset();
      sharedInterruptFn.mockImplementation(() => Promise.resolve());
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

    it('calls session.interrupt with the correct sessionId before SIGTERM', async () => {
      const store = new InMemorySessionMetadataStore();
      store.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        agentName: 'build',
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

      const { interrupt } = stubSdkClientForStop();

      await service.stop(4321);

      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(interrupt).toHaveBeenCalledWith({ sessionID: 'sess-1' });
      expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(interrupt.mock.invocationCallOrder[0]).toBeLessThan(kill.mock.invocationCallOrder[0]);
      expect(store.get('sess-1')).toBeUndefined();
    });

    it('proceeds with SIGTERM even if session.interrupt throws', async () => {
      const store = new InMemorySessionMetadataStore();
      store.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        agentName: 'build',
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
      stubSdkClientForStop({ interruptThrows: new Error('connection refused') });

      await expect(service.stop(4321)).resolves.toBeUndefined();
      expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(store.get('sess-1')).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('startSessionEventForwarder handle includes armTurnEnd', async () => {
      const handle = realStartForwarder(
        {
          event: {
            subscribe: () => NEVER_STREAM(),
          },
        },
        {
          sessionId: 'test',
          role: 'builder',
        }
      );
      expect(typeof handle.armTurnEnd).toBe('function');
      handle.stop();
    });

    it('resumeTurn succeeds when stop() was not called (metadata preserved)', async () => {
      const sessionStore = new InMemorySessionMetadataStore();
      sessionStore.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        agentName: 'build',
        pid: 4321,
        createdAt: new Date().toISOString(),
        baseUrl: 'http://127.0.0.1:5678',
        model: TEST_MODEL_OPENCODE,
      });
      const deps = createMockDeps({ sessionMetadataStore: sessionStore });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      await service.resumeTurn(4321, 'resume prompt');

      expect(sharedPromptFn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: 'sess-1', text: 'resume prompt' })
      );
      expect(sessionStore.get('sess-1')).toBeDefined();
    });

    it('resumeTurn returns without throwing when metadata was removed', async () => {
      const sessionStore = new InMemorySessionMetadataStore();
      sessionStore.upsert({
        sessionId: 'sess-1',
        machineId: 'm1',
        chatroomId: 'c1',
        role: 'builder',
        agentName: 'build',
        pid: 4321,
        createdAt: new Date().toISOString(),
        baseUrl: 'http://127.0.0.1:5678',
      });
      const deps = createMockDeps({ sessionMetadataStore: sessionStore });
      stubSdkClient();
      sharedPromptFn.mockClear();
      const service = new OpenCodeSdkAgentService(deps);

      sessionStore.remove('sess-1');

      await expect(service.resumeTurn(4321, 'prompt')).resolves.toBeUndefined();
      expect(sharedPromptFn).not.toHaveBeenCalled();
    });

    it('resumeTurn falls back to fresh session when prompt fails', async () => {
      const sessionStore = new InMemorySessionMetadataStore();
      const child = makeFakeChild(4321);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        sessionMetadataStore: sessionStore,
      });
      // Restore the full client (the stop block installs a minimal one).
      vi.mocked(OpenCode.make).mockImplementation(
        () =>
          ({
            session: {
              create: sharedCreateFn,
              get: sharedGetFn,
              interrupt: sharedInterruptFn,
              prompt: sharedPromptFn,
              switchAgent: sharedSwitchAgentFn,
              switchModel: sharedSwitchModelFn,
              instructions: { entry: { put: sharedInstructionPutFn } },
            },
            agent: { list: sharedAgentListFn },
            event: { subscribe: sharedEventSubscribeFn },
          }) as unknown as ReturnType<typeof OpenCode.make>
      );
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      sharedPromptFn.mockRejectedValueOnce(new Error('session not found')).mockResolvedValue({});
      sharedCreateFn.mockResolvedValue({ id: 'sess-2' });

      await expect(service.resumeTurn(result.pid, 'resume prompt')).resolves.toBeUndefined();

      expect(sharedCreateFn).toHaveBeenCalled();
      expect(sessionStore.get('sess-2')).toBeDefined();
      expect(sessionStore.get('sess-1')).toBeUndefined();
      expect(sharedPromptFn).toHaveBeenCalledTimes(3);
    });

    it('resume fallback session.create passes location.directory from the spawn workingDir', async () => {
      const sessionStore = new InMemorySessionMetadataStore();
      const child = makeFakeChild(4321);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        sessionMetadataStore: sessionStore,
      });
      vi.mocked(OpenCode.make).mockImplementation(
        () =>
          ({
            session: {
              create: sharedCreateFn,
              get: sharedGetFn,
              interrupt: sharedInterruptFn,
              prompt: sharedPromptFn,
              switchAgent: sharedSwitchAgentFn,
              switchModel: sharedSwitchModelFn,
              instructions: { entry: { put: sharedInstructionPutFn } },
            },
            agent: { list: sharedAgentListFn },
            event: { subscribe: sharedEventSubscribeFn },
          }) as unknown as ReturnType<typeof OpenCode.make>
      );
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn({ ...spawnOptions(), workingDir: '/tmp/workspace' });
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;
      expect(sessionStore.get('sess-1')?.workingDir).toBe('/tmp/workspace');

      sharedCreateFn.mockClear();
      sharedPromptFn.mockRejectedValueOnce(new Error('session not found')).mockResolvedValue({});
      sharedCreateFn.mockResolvedValue({ id: 'sess-2' });

      await service.resumeTurn(result.pid, 'resume prompt');

      expect(sharedCreateFn).toHaveBeenCalledTimes(1);
      expect(sharedCreateFn.mock.calls[0][0].location).toEqual({ directory: '/tmp/workspace' });
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

      expect(vi.mocked(OpenCode.make)).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(-9999, 'SIGTERM');
    });
  });

  describe('spawn lifecycle', () => {
    beforeEach(() => {
      vi.mocked(OpenCode.make).mockReset();
    });

    it('happy path: spawns serve, parses URL, creates session, sends prompt with built-in agent', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: TEST_MODEL_OPENCODE, systemPrompt: 'sys', prompt: 'hello' })
      );
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );

      const result = await spawnPromise;

      expect(result.pid).toBe(4321);
      expect(deps.spawn).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--print-logs', '--log-level', 'warn'],
        expect.objectContaining({ cwd: '/tmp/test', detached: true })
      );

      expect(sdk.create).toHaveBeenCalledTimes(1);
      const createCall = sdk.create.mock.calls[0][0];
      expect(createCall.agent).toBe('build');
      expect(createCall.model).toEqual({ providerID: 'opencode', id: 'big-pickle' });
      expect(createCall.location).toEqual({ directory: '/tmp/test' });
      expect(createCall.permissions).toEqual([
        { action: 'subagent', resource: '*', effect: 'deny' },
        { action: 'question', resource: '*', effect: 'deny' },
        { action: 'external_directory', resource: '*', effect: 'deny' },
      ]);

      expect(sdk.prompt).toHaveBeenCalledTimes(1);
      expect(sdk.prompt).toHaveBeenCalledWith({ sessionID: 'sess-1', text: 'hello' });
      expect(sdk.instructionPut).toHaveBeenCalledWith({
        sessionID: 'sess-1',
        key: 'chatroom-role',
        value: 'sys',
      });
    });

    it('deferInitialTurn skips prompt on spawn and delivers system on resume', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn({
        ...spawnOptions({ systemPrompt: 'sys', prompt: 'bootstrap' }),
        deferInitialTurn: true,
      });
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );

      const result = await spawnPromise;
      expect(result.pid).toBe(4321);
      expect(sdk.create).toHaveBeenCalledTimes(1);
      expect(sdk.prompt).not.toHaveBeenCalled();
      expect(sdk.instructionPut).not.toHaveBeenCalled();

      await service.resumeTurn(result.pid, 'injected task');
      expect(sdk.instructionPut).toHaveBeenCalledWith({
        sessionID: 'sess-1',
        key: 'chatroom-role',
        value: 'sys',
      });
      expect(sdk.prompt).toHaveBeenCalledTimes(1);
      expect(sdk.prompt).toHaveBeenCalledWith({ sessionID: 'sess-1', text: 'injected task' });

      void service.stop(result.pid);
    });

    it('always selects the build agent regardless of role (role context lives in the instruction entry)', async () => {
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

      expect(sdk.create.mock.calls[0][0].agent).toBe('build');
    });

    it('omits the instruction entry when chatroom systemPrompt is empty', async () => {
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

      expect(sdk.instructionPut).not.toHaveBeenCalled();
    });

    it('omits the instruction entry when chatroom systemPrompt is whitespace only', async () => {
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

      expect(sdk.instructionPut).not.toHaveBeenCalled();
    });

    it('falls back to the first primary agent when build is absent', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      sharedAgentListFn.mockImplementation(() =>
        Promise.resolve({ data: [makeAgent('general', 'primary', 'G')] })
      );
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ prompt: 'hello', systemPrompt: 'sys' }));
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].agent).toBe('general');
      expect(sdk.instructionPut).toHaveBeenCalledWith({
        sessionID: 'sess-1',
        key: 'chatroom-role',
        value: 'sys',
      });
    });

    it('filters out subagents and uses the first primary', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      sharedAgentListFn.mockImplementation(() =>
        Promise.resolve({
          data: [makeAgent('sub', 'subagent', 'X'), makeAgent('general', 'primary', 'G')],
        })
      );
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].agent).toBe('general');
    });

    it('rejects spawn and writes role-prefixed spawn-error when agent list is empty', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      sharedAgentListFn.mockImplementation(() => Promise.resolve({ data: [] }));
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({}, { role: 'planner' }));
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );

      await expect(spawnPromise).rejects.toThrow(/No usable opencode agent available/);
      expect(child.kill).toHaveBeenCalled();
      expect(stderrWriteSpy).toHaveBeenCalledWith(
        expect.stringMatching(/role:planner spawn-error\] No usable opencode agent available/)
      );
    });

    it('rejects spawn and writes role-prefixed spawn-error when agent.list times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        stubSdkClient();
        sharedAgentListFn.mockImplementation(() => new Promise(() => {}));
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions({}, { role: 'planner' }));
        child.stdout.emit(
          'data',
          Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
        );
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(11_000); // past 10s timeout

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/agent\.list.*timed out/i);
        expect(child.kill).toHaveBeenCalled();
        expect(stderrWriteSpy).toHaveBeenCalledWith(
          expect.stringMatching(/role:planner spawn-error\] agent\.list.*timed out/)
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects with timeout error when serve never prints a URL, and kills the child', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        stubSdkClient();
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
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
        child.emit('exit', 1, null);
        await vi.advanceTimersByTimeAsync(100);

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
      child.stdout.emit(
        'data',
        Buffer.from('upgrade available at https://opencode.ai/releases/v1.0\n')
      );
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await spawnPromise;

      expect(vi.mocked(OpenCode.make)).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://127.0.0.1:5678' })
      );
    });

    it('strips trailing punctuation (period) from captured URL', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678.\n')
      );
      await spawnPromise;

      expect(vi.mocked(OpenCode.make)).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://127.0.0.1:5678' })
      );
    });

    it('kills the serve child and writes role-prefixed spawn-error when prompt rejects', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ promptThrows: new Error('provider auth failed') });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));

      await expect(spawnPromise).rejects.toThrow(/provider auth failed/);
      expect(child.kill).toHaveBeenCalled();
      expect(stderrWriteSpy).toHaveBeenCalledWith(
        expect.stringMatching(/role:[a-z]+ spawn-error\] provider auth failed/)
      );
    });

    it('kills the serve child when session.create times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        const sdk = stubSdkClient();
        sdk.create.mockImplementation(() => new Promise(() => {}));
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(31_000);

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/session\.create.*timed out/i);
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('kills the serve child when prompt times out', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild(4321);
        const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
        const sdk = stubSdkClient();
        sdk.prompt.mockImplementation(() => new Promise(() => {}));
        const service = new OpenCodeSdkAgentService(deps);

        const spawnPromise = service.spawn(spawnOptions());
        child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
        const settled = spawnPromise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(61_000);

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/session\.prompt.*timed out/i);
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects and kills the child when session.create returns no id', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ sessionCreateResult: { id: undefined } });
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

    it('returns activityEmitter with transport and progress signals from session events', async () => {
      let releaseEvent: (() => void) | undefined;
      const eventGate = new Promise<void>((resolve) => {
        releaseEvent = resolve;
      });

      async function* gatedStream(): AsyncGenerator<unknown> {
        await eventGate;
        yield {
          type: 'session.text.delta',
          data: { sessionID: 'sess-1', assistantMessageID: 'm1', ordinal: 0, delta: 'typed hello' },
        };
        await new Promise(() => {});
      }

      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({ subscribeStream: gatedStream() });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      expect(result.activityEmitter).toBeDefined();
      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));

      releaseEvent!();
      await vi.waitFor(() =>
        expect(signals.some((s) => s.source === 'opencode.session.text.delta')).toBe(true)
      );

      expect(signals.some((s) => s.kind === 'transport')).toBe(true);
      expect(signals.some((s) => s.kind === 'progress')).toBe(true);
    });

    it('process stdout/stderr emits transport on activityEmitter without progress', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));

      child.stdout.emit('data', Buffer.from('chunk-1'));
      child.stderr.emit('data', Buffer.from('chunk-2'));

      await vi.waitFor(() =>
        expect(signals.some((s) => s.source === 'opencode.process.stdout')).toBe(true)
      );
      expect(signals.some((s) => s.source === 'opencode.process.stderr')).toBe(true);
      expect(signals.every((s) => s.kind === 'transport')).toBe(true);
    });

    it('resumeTurn fallback reuses the same activityEmitter across fresh session', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        sessionMetadataStore: new InMemorySessionMetadataStore(),
      });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;
      const originalEmitter = result.activityEmitter;

      sharedPromptFn.mockClear();
      sharedPromptFn.mockRejectedValueOnce(new Error('session not found')).mockResolvedValue({});
      sharedCreateFn.mockResolvedValue({ id: 'sess-2' });

      await service.resumeTurn(result.pid, 'resume prompt');

      expect(originalEmitter).toBe(result.activityEmitter);
    });

    it('forwards model slug with a single slash as {providerID, id}', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ model: 'github-copilot/gpt-4o' }));
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].model).toEqual({
        providerID: 'github-copilot',
        id: 'gpt-4o',
      });
    });

    it('forwards model slug with a multi-segment modelID (split on first slash only)', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: `${TEST_MODEL_OPENCODE}/thinking` })
      );
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].model).toEqual({
        providerID: 'opencode',
        id: 'big-pickle/thinking',
      });
    });

    it('throws when no model is provided', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new OpenCodeSdkAgentService(deps);

      await expect(
        service.spawn(spawnOptions({ model: undefined as unknown as string }))
      ).rejects.toThrow('Harness model is required');
    });

    it('omits the model field when the slug has no provider prefix (malformed input)', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions({ model: 'no-slash-here' }));
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].model).toBeUndefined();
    });

    it('forwards variant from bracket model string', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const sdk = stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(
        spawnOptions({ model: 'opencode-go/gpt-5.6-luna[variant=max]' })
      );
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      await spawnPromise;

      expect(sdk.create.mock.calls[0][0].model).toEqual({
        providerID: 'opencode-go',
        id: 'gpt-5.6-luna',
        variant: 'max',
      });
    });

    it('routes non-INFO child stderr to onLogLine and filters INFO lines', async () => {
      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient();
      const service = new OpenCodeSdkAgentService(deps);
      const logLines: string[] = [];

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;
      result.onLogLine?.((line) => logLines.push(line));

      child.stdout.emit(
        'data',
        Buffer.from('INFO  2026-04-25T04:13:56 service=bus type=file.watcher.updated publishing\n')
      );
      child.stderr.emit(
        'data',
        Buffer.from('WARN  2026-04-25T04:13:57 service=foo something interesting\n')
      );

      expect(logLines.some((line) => line.includes('file.watcher.updated'))).toBe(false);
      expect(logLines.some((line) => line.includes('something interesting'))).toBe(true);
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
          yield { type: 'session.status', data: { sessionID: 'sess-1', status: { type: 'busy' } } };
          await new Promise(() => {});
        })(),
      });
      const service = new OpenCodeSdkAgentService(deps);

      const spawnPromise = service.spawn(spawnOptions());
      child.stdout.emit('data', Buffer.from('opencode server listening on http://127.0.0.1:1\n'));
      const result = await spawnPromise;

      await service.stop(result.pid);

      expect(sharedInterruptFn).toHaveBeenCalled();
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

    it('C-E4: prompt rejection stops the forwarder before rethrowing', async () => {
      const child = makeFakeChild(9004);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      stubSdkClient({
        promptThrows: new Error('prompt failed'),
        subscribeStream: (async function* () {
          yield { type: 'session.status', data: { sessionID: 'sess-1', status: { type: 'busy' } } };
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
