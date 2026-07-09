import { EventEmitter } from 'node:events';

import { Cursor } from '@cursor/sdk';
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import {
  CursorSdkAgentService,
  type CursorSdkAgentServiceDeps,
} from './cursor-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const sharedAgentCreateFn = vi.fn();
const sharedAgentResumeFn = vi.fn();
const sharedAgentSendFn = vi.fn();
const sharedAgentCloseFn = vi.fn();

vi.mock('@cursor/sdk', () => ({
  configureCursorSdk: vi.fn(),
  Agent: {
    create: (...args: unknown[]) => sharedAgentCreateFn(...args),
    resume: (...args: unknown[]) => sharedAgentResumeFn(...args),
  },
  Cursor: {
    models: {
      list: vi.fn(),
    },
  },
}));

vi.mock('./cursor-sdk-package.js', () => ({
  importBundledCursorSdk: vi.fn(async () => import('@cursor/sdk')),
  getBundledCursorSdkVersion: vi.fn(() => '1.0.23'),
  formatCursorSdkError: (err: unknown) => {
    if (err instanceof Error) {
      const sdkErr = err as Error & { code?: string; name?: string };
      const code = sdkErr.code ? `[${sdkErr.code}] ` : '';
      const name = sdkErr.name && sdkErr.name !== 'Error' ? `${sdkErr.name}: ` : '';
      return `${name}${code}${err.message}`.trim();
    }
    return String(err);
  },
  formatCursorSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function createMockDeps(overrides?: Partial<CursorSdkAgentServiceDeps>): CursorSdkAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

function makeFakeChild(pid = 4321) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.kill = vi.fn();
  return child;
}

function stubSdkAgent() {
  const run = {
    id: 'run-1',
    stream: async function* () {},
    wait: vi.fn().mockResolvedValue({ id: 'run-1', status: 'finished' }),
    supports: () => false,
    cancel: vi.fn(),
  };

  const agent = {
    agentId: 'agent-1',
    send: sharedAgentSendFn.mockResolvedValue(run),
    close: sharedAgentCloseFn,
  };

  sharedAgentCreateFn.mockResolvedValue(agent);
  return { agent, run };
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };

describe('CursorSdkAgentService', () => {
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>;
  const originalApiKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    sharedAgentCreateFn.mockReset();
    sharedAgentResumeFn.mockReset();
    sharedAgentSendFn.mockReset();
    sharedAgentCloseFn.mockReset();
    vi.mocked(Cursor.models.list).mockReset();
    process.env.CURSOR_API_KEY = 'cursor_test_key';
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    if (originalApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = originalApiKey;
    }
  });

  describe('isInstalled', () => {
    it('returns false when CURSOR_API_KEY is not set', async () => {
      delete process.env.CURSOR_API_KEY;
      const service = new CursorSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(false);
    });

    it('returns true when CURSOR_API_KEY is set', async () => {
      const service = new CursorSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(true);
    });
  });

  describe('spawn', () => {
    it('calls Agent.create with apiKey and local cwd', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(sharedAgentCreateFn).toHaveBeenCalledWith({
        apiKey: 'cursor_test_key',
        name: 'builder@c1',
        model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'false' }] },
        local: { cwd: '/tmp/work', settingSources: [] },
      });
    });

    it('writes spawn-error to stderr when Agent.create fails', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);
      const createError = Object.assign(new Error('sandbox not supported: bubblewrap missing'), {
        name: 'ConfigurationError',
      });
      sharedAgentCreateFn.mockRejectedValue(createError);

      await expect(
        service.spawn({
          workingDir: '/tmp/work',
          prompt: createSpawnPrompt('do work'),
          systemPrompt: 'you are helpful',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        })
      ).rejects.toThrow('sandbox not supported: bubblewrap missing');

      expect(stderrWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[cursor-sdk:builder@c1 spawn-error] ConfigurationError: sandbox not supported: bubblewrap missing'
        )
      );
      expect(child.kill).toHaveBeenCalled();
    });

    it('calls agent.send with combined system and user prompt', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(sharedAgentSendFn).toHaveBeenCalledWith(
        'NEVER spawn subagents. Follow the chatroom instructions strictly.\n\nyou are helpful\n\ndo work',
        expect.objectContaining({
          local: { force: true },
          idempotencyKey: expect.any(String),
        })
      );
    });

    it('returns harnessSessionId and harnessReconnect from Agent.create', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        model: 'composer-2.5',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(result.harnessSessionId).toBe('agent-1');
      expect(result.harnessReconnect).toEqual({
        agentName: 'builder@c1',
        model: 'composer-2.5',
      });
    });

    it('deferInitialTurn skips agent.send until resumeTurn', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });

      await vi.waitFor(() => expect(sharedAgentSendFn).not.toHaveBeenCalled());

      await service.resumeTurn(result.pid, 'injected task');
      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalledTimes(1));
      expect(sharedAgentSendFn.mock.calls[0][0]).toContain('you are helpful');
      expect(sharedAgentSendFn.mock.calls[0][0]).toContain('injected task');

      const exitInfo = vi.fn();
      result.onExit(exitInfo);
      void service.stop(result.pid);
      await vi.waitFor(() => expect(exitInfo).toHaveBeenCalled(), { timeout: 3000 });
    });
  });

  describe('stop', () => {
    it('calls agent.close()', async () => {
      stubSdkAgent();
      const child = makeFakeChild(5555);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await service.stop(result.pid);

      expect(sharedAgentCloseFn).toHaveBeenCalled();
    });

    it('preserveForResume skips agent.close()', async () => {
      stubSdkAgent();
      const child = makeFakeChild(5556);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      sharedAgentCloseFn.mockClear();
      await service.stop(result.pid, { preserveForResume: true });

      expect(sharedAgentCloseFn).not.toHaveBeenCalled();
    });

    it('skips run.wait when aborted during stream', async () => {
      const runWait = vi.fn().mockImplementation(() => new Promise(() => {}));
      const run = {
        id: 'run-1',
        stream: async function* () {
          yield { type: 'assistant' };
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        },
        wait: runWait,
        supports: () => true,
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      const agent = {
        agentId: 'agent-1',
        send: sharedAgentSendFn.mockResolvedValue(run),
        close: sharedAgentCloseFn,
      };
      sharedAgentCreateFn.mockResolvedValue(agent);

      const child = makeFakeChild(7777);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const exitInfo = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      result.onExit(exitInfo);

      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalled());
      await service.stop(result.pid);

      await vi.waitFor(() => expect(exitInfo).toHaveBeenCalled(), { timeout: 3000 });
      expect(runWait).not.toHaveBeenCalled();
      expect(exitInfo).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1, signal: 'SIGTERM' })
      );
    });
  });

  describe('resumeTurn', () => {
    it('delivers prompt and continues with the next agent.send turn', async () => {
      stubSdkAgent();
      const child = makeFakeChild(8888);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      const waitingForResume = new Promise<void>((resolve) => {
        if (!result.onAgentEnd) throw new Error('expected onAgentEnd');
        result.onAgentEnd(resolve);
      });

      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalledTimes(1));
      await waitingForResume;

      await service.resumeTurn(result.pid, 'resume prompt');

      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalledTimes(2));
      expect(sharedAgentSendFn.mock.calls[1][0]).toBe('resume prompt');
    });

    it('queues resumeTurn when session is mid-turn', async () => {
      const runWait = vi.fn().mockImplementation(() => new Promise(() => {}));
      const run = {
        id: 'run-1',
        stream: async function* () {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        },
        wait: runWait,
        supports: () => false,
        cancel: vi.fn(),
      };

      const agent = {
        agentId: 'agent-1',
        send: sharedAgentSendFn.mockResolvedValue(run),
        close: sharedAgentCloseFn,
      };
      sharedAgentCreateFn.mockResolvedValue(agent);

      const child = makeFakeChild(9999);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      await expect(service.resumeTurn(9999, 'prompt')).rejects.toThrow('No cursor-sdk session');

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalled());

      await expect(service.resumeTurn(result.pid, 'queued prompt')).resolves.toBeUndefined();

      await service.stop(result.pid);
    });

    it('fires onAgentEnd only after run.wait() completes (not on in-stream status)', async () => {
      const runWait = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { id: 'run-1', status: 'finished' };
      });
      const run = {
        id: 'run-1',
        stream: async function* () {
          yield {
            type: 'status',
            agent_id: 'agent-1',
            run_id: 'run-1',
            status: 'FINISHED',
          };
        },
        wait: runWait,
        supports: () => false,
        cancel: vi.fn(),
      };

      const agent = {
        agentId: 'agent-1',
        send: sharedAgentSendFn.mockResolvedValue(run),
        close: sharedAgentCloseFn,
      };
      sharedAgentCreateFn.mockResolvedValue(agent);

      const child = makeFakeChild(7778);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const agentEndTimes: number[] = [];
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      if (!result.onAgentEnd) throw new Error('expected onAgentEnd');
      result.onAgentEnd(() => agentEndTimes.push(Date.now()));

      await vi.waitFor(() => expect(agentEndTimes).toHaveLength(1));
      expect(runWait).toHaveBeenCalled();
    });

    it('stop while waiting for resume exits the session', async () => {
      stubSdkAgent();
      const child = makeFakeChild(6666);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const exitInfo = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      result.onExit(exitInfo);

      await vi.waitFor(() => expect(sharedAgentSendFn).toHaveBeenCalledTimes(1));

      await service.stop(result.pid);

      await vi.waitFor(() => expect(exitInfo).toHaveBeenCalled(), { timeout: 3000 });
      expect(sharedAgentCloseFn).toHaveBeenCalled();
    });
  });

  describe('turn loop errors', () => {
    it('writes spawn-error and exits when the run stream throws (e.g. Cursor auth failure)', async () => {
      const authError = Object.assign(new Error('[unauthenticated] Error'), {
        name: 'ConnectError',
        code: 16,
      });
      const run = {
        id: 'run-auth-fail',
        stream: async function* () {
          yield {
            type: 'status',
            agent_id: 'agent-1',
            run_id: 'run-auth-fail',
            status: 'ERROR',
          };
          throw authError;
        },
        wait: vi.fn(),
        supports: () => false,
        cancel: vi.fn(),
      };

      const agent = {
        agentId: 'agent-1',
        send: sharedAgentSendFn.mockResolvedValue(run),
        close: sharedAgentCloseFn,
      };
      sharedAgentCreateFn.mockResolvedValue(agent);

      const child = makeFakeChild(5555);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const exitInfo = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      result.onExit(exitInfo);

      await vi.waitFor(() => expect(exitInfo).toHaveBeenCalled(), { timeout: 3000 });
      expect(stderrWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[cursor-sdk:builder@c1 spawn-error] ConnectError: [16] [unauthenticated] Error'
        )
      );
      expect(run.wait).not.toHaveBeenCalled();
      expect(exitInfo).toHaveBeenCalledWith(expect.objectContaining({ code: 1, signal: null }));
      expect(sharedAgentCloseFn).toHaveBeenCalled();
    });

    it('writes spawn-error and exits when run.wait rejects after a successful stream', async () => {
      const waitError = Object.assign(new Error('[unauthenticated] Error'), {
        name: 'ConnectError',
        code: 16,
      });
      const run = {
        id: 'run-wait-fail',
        stream: async function* () {},
        wait: vi.fn().mockRejectedValue(waitError),
        supports: () => false,
        cancel: vi.fn(),
      };

      const agent = {
        agentId: 'agent-1',
        send: sharedAgentSendFn.mockResolvedValue(run),
        close: sharedAgentCloseFn,
      };
      sharedAgentCreateFn.mockResolvedValue(agent);

      const child = makeFakeChild(5556);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValue(child),
        kill: vi.fn((_pid: number, signal: number | string) => {
          if (signal === 0) throw new Error('process not found');
          return true;
        }),
      });
      const service = new CursorSdkAgentService(deps);

      const exitInfo = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      result.onExit(exitInfo);

      await vi.waitFor(() => expect(exitInfo).toHaveBeenCalled(), { timeout: 3000 });
      expect(stderrWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[cursor-sdk:builder@c1 spawn-error] ConnectError: [16] [unauthenticated] Error'
        )
      );
      expect(exitInfo).toHaveBeenCalledWith(expect.objectContaining({ code: 1, signal: null }));
      expect(sharedAgentCloseFn).toHaveBeenCalled();
    });
  });

  describe('getHarnessReconnectContext', () => {
    it('returns agentName and model while session is active', async () => {
      stubSdkAgent();
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'system',
        model: 'composer-2.5',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(service.getHarnessReconnectContext(result.pid)).toEqual({
        agentName: 'builder@c1',
        model: 'composer-2.5',
      });
    });
  });

  describe('resumeFromDaemonMemory', () => {
    it('reconnects via Agent.resume and sends the spawn prompt', async () => {
      const { agent } = stubSdkAgent();
      sharedAgentResumeFn.mockResolvedValue(agent);

      const child = makeFakeChild(4321);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CursorSdkAgentService(deps);

      const result = await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/resume-wd',
          prompt: createSpawnPrompt('resume hello'),
          systemPrompt: 'sys',
          model: 'composer-2.5',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        },
        {
          harnessSessionId: 'agent-resume-1',
          agentName: 'builder@c1',
          workingDir: '/tmp/resume-wd',
          model: 'composer-2.5',
        }
      );

      expect(sharedAgentCreateFn).not.toHaveBeenCalled();
      expect(sharedAgentResumeFn).toHaveBeenCalledWith('agent-resume-1', {
        apiKey: 'cursor_test_key',
        model: { id: 'composer-2.5' },
        local: { cwd: '/tmp/resume-wd', settingSources: [] },
      });
      expect(result.pid).toBe(4321);
      expect(result.harnessSessionId).toBe('agent-1');
      expect(result.harnessReconnect).toEqual({
        agentName: 'builder@c1',
        model: 'composer-2.5',
      });
      expect(sharedAgentSendFn).toHaveBeenCalledWith(
        'NEVER spawn subagents. Follow the chatroom instructions strictly.\n\nsys\n\nresume hello',
        expect.objectContaining({ local: { force: true } })
      );
    });

    it('falls back to spawn when Agent.resume fails', async () => {
      sharedAgentResumeFn.mockRejectedValue(new Error('agent not found'));
      sharedAgentCreateFn.mockResolvedValue({
        agentId: 'agent-fresh-1',
        send: sharedAgentSendFn,
        close: vi.fn(),
      });

      const keeper = makeFakeChild(4321);
      const spawnKeeper = makeFakeChild(4322);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValueOnce(keeper).mockReturnValueOnce(spawnKeeper),
      });
      const service = new CursorSdkAgentService(deps);

      const result = await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/resume-wd',
          prompt: createSpawnPrompt('resume hello'),
          systemPrompt: 'sys',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        },
        {
          harnessSessionId: 'missing-agent',
          agentName: 'builder@c1',
          workingDir: '/tmp/resume-wd',
        }
      );

      expect(sharedAgentCreateFn).toHaveBeenCalled();
      expect(result.pid).toBe(4322);
      expect(keeper.kill).toHaveBeenCalled();
    });
  });

  describe('listModels', () => {
    it('maps SDK default to UI-centric auto', async () => {
      vi.mocked(Cursor.models.list).mockResolvedValue([
        { id: 'default' },
        { id: 'composer-2.5' },
      ] as Awaited<ReturnType<typeof Cursor.models.list>>);

      const service = new CursorSdkAgentService(createMockDeps());
      await expect(service.listModels()).resolves.toEqual(['auto', 'composer-2.5']);
    });

    it('returns empty list when CURSOR_API_KEY is unset', async () => {
      process.env.CURSOR_API_KEY = '';
      const service = new CursorSdkAgentService(createMockDeps());
      await expect(service.listModels()).resolves.toEqual([]);
      expect(Cursor.models.list).not.toHaveBeenCalled();
    });

    it('returns [] when Cursor.models.list fails', async () => {
      vi.mocked(Cursor.models.list).mockRejectedValue(new Error('network down'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const service = new CursorSdkAgentService(createMockDeps());
      await expect(service.listModels()).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
