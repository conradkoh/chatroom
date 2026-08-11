import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import {
  CodexSdkAgentService,
  resetCodexSdkModuleCacheForTests,
  type CodexSdkAgentServiceDeps,
} from './codex-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const mockStartThread = vi.fn();
const mockResumeThread = vi.fn();
const mockRunStreamed = vi.fn();
const mockCodex = vi.fn();

vi.mock('@openai/codex-sdk', () => ({
  Codex: mockCodex,
}));

vi.mock('./codex-sdk-package.js', () => ({
  importBundledCodexSdk: vi.fn(async () => ({
    Codex: mockCodex,
  })),
  getBundledCodexSdkVersion: vi.fn(() => '0.147.0'),
  formatCodexSdkError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  formatCodexSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function createMockDeps(overrides?: Partial<CodexSdkAgentServiceDeps>): CodexSdkAgentServiceDeps {
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

function makeThread(overrides?: Record<string, unknown>) {
  return {
    id: null,
    runStreamed: mockRunStreamed,
    ...overrides,
  };
}

function stubStream(events: Record<string, unknown>[], overrides?: Record<string, unknown>) {
  const thread = makeThread(overrides);
  mockStartThread.mockReturnValue(thread);
  mockResumeThread.mockReturnValue(thread);
  mockRunStreamed.mockResolvedValue({
    events: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  });
  return thread;
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THREAD_ID = 'codex-thread-abc';

function completedTurnEvents(): Record<string, unknown>[] {
  return [
    { type: 'thread.started', thread_id: THREAD_ID },
    {
      type: 'item.completed',
      item: { id: 'i1', type: 'agent_message', text: 'hello' },
    },
    {
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 2,
      },
    },
  ];
}

describe('CodexSdkAgentService', () => {
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    resetCodexSdkModuleCacheForTests();
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockCodex.mockReset();
    mockCodex.mockImplementation(
      class {
        startThread = mockStartThread;
        resumeThread = mockResumeThread;
      } as never
    );
    mockStartThread.mockClear();
    mockResumeThread.mockClear();
    mockRunStreamed.mockClear();
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
  });

  describe('isInstalled', () => {
    it('returns false when SDK load fails', async () => {
      vi.resetModules();
      vi.doMock('./codex-sdk-package.js', () => ({
        importBundledCodexSdk: vi.fn(async () => {
          throw new Error('SDK missing');
        }),
        getBundledCodexSdkVersion: vi.fn(() => '0.147.0'),
        formatCodexSdkError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
        formatCodexSdkLoadError: (err: unknown) =>
          err instanceof Error ? err.message : String(err),
      }));
      const { CodexSdkAgentService: IsolatedService } =
        await import('./codex-sdk-agent-service.js');
      const service = new IsolatedService(createMockDeps());
      expect(await service.isInstalled()).toBe(false);
      vi.resetModules();
    });

    it('returns true when SDK loads', async () => {
      const service = new CodexSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(true);
    });
  });

  describe('getVersion', () => {
    it('returns pinned SDK semver', async () => {
      const service = new CodexSdkAgentService(createMockDeps());
      await expect(service.getVersion()).resolves.toEqual({
        version: '0.147.0',
        major: 0,
      });
    });
  });

  describe('listModels', () => {
    it('returns an empty list (Codex SDK exposes no model enumeration)', async () => {
      const service = new CodexSdkAgentService(createMockDeps());
      expect(await service.listModels()).toEqual([]);
    });
  });

  describe('spawn', () => {
    it('starts a thread with working directory and streams a turn to onAgentEnd', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const onOutput = vi.fn();
      const onAgentEnd = vi.fn();

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(result.pid).toBe(4321);
      expect(result.harnessSessionId).toMatch(UUID_PATTERN);
      expect(deps.spawn).toHaveBeenCalled();

      result.onOutput(onOutput);
      result.onAgentEnd?.(onAgentEnd);

      await vi.waitFor(() => expect(onAgentEnd).toHaveBeenCalledTimes(1));
      expect(onOutput).toHaveBeenCalled();

      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/tmp/work',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
      });
      expect(mockCodex).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({ CHATROOM_CONVEX_URL: 'http://test:3210' }),
        })
      );
      expect(mockRunStreamed).toHaveBeenCalledWith(
        expect.stringContaining('you are helpful'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('passes a model through to thread options when provided', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        model: 'gpt-5.6',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockStartThread).toHaveBeenCalled());
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/tmp/work',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        model: 'gpt-5.6',
      });
    });

    it('deferInitialTurn skips runStreamed until resumeTurn', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });

      await vi.waitFor(() => expect(mockRunStreamed).not.toHaveBeenCalled());

      await service.resumeTurn(result.pid, 'injected task');
      await vi.waitFor(() => expect(mockRunStreamed).toHaveBeenCalledTimes(1));
      expect(mockRunStreamed.mock.calls[0][0]).toContain('injected task');
      expect(mockRunStreamed.mock.calls[0][0]).toContain('you are helpful');
    });

    it('native multi-turn invariant: two resumeTurns each emit onAgentEnd', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const onEnd = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });
      if (!result.onAgentEnd) throw new Error('expected onAgentEnd');
      result.onAgentEnd(onEnd);

      await service.resumeTurn(result.pid, 'first task');
      await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));

      await service.resumeTurn(result.pid, 'second task');
      await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(2));
      expect(mockRunStreamed).toHaveBeenCalledTimes(2);
    });

    it('fires onHarnessSessionIdUpdated when thread.started reports the thread id', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const onSessionIdUpdated = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });
      result.onHarnessSessionIdUpdated?.(onSessionIdUpdated);

      await vi.waitFor(() => expect(onSessionIdUpdated).toHaveBeenCalledTimes(1));
      expect(onSessionIdUpdated).toHaveBeenCalledWith({
        correlationId: result.harnessSessionId,
        resumableId: THREAD_ID,
        source: 'provider_allocated',
      });
    });
  });

  describe('model variants', () => {
    it('decodes a reasoning variant into model + SDK reasoning option', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        model: 'gpt-5.6-sol[reasoning=high]',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockStartThread).toHaveBeenCalled());
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/tmp/work',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        model: 'gpt-5.6-sol',
        modelReasoningEffort: 'high',
      });
    });

    it('omits the SDK reasoning option for reasoning=none', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        model: 'gpt-5.6-sol[reasoning=none]',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockStartThread).toHaveBeenCalled());
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/tmp/work',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        model: 'gpt-5.6-sol',
      });
    });

    it('refuses to start on a malformed variant', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp/work',
          prompt: createSpawnPrompt('do work'),
          systemPrompt: 'you are helpful',
          model: 'gpt-5.6-sol[reasoning',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        })
      ).rejects.toThrow('malformed model variant');
      // Refusal happens before any side effects (no keeper process spawned).
      expect(deps.spawn).not.toHaveBeenCalled();
    });

    it('refuses to start on an unknown variant param', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp/work',
          prompt: createSpawnPrompt('do work'),
          systemPrompt: 'you are helpful',
          model: 'gpt-5.6-sol[thinking=high]',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        })
      ).rejects.toThrow('unsupported variant params');
      expect(deps.spawn).not.toHaveBeenCalled();
    });

    it('refuses to start on a disallowed reasoning value', async () => {
      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await expect(
        service.spawn({
          workingDir: '/tmp/work',
          prompt: createSpawnPrompt('do work'),
          systemPrompt: 'you are helpful',
          model: 'gpt-5.6-sol[reasoning=ultra]',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        })
      ).rejects.toThrow('unsupported variant params');
      expect(deps.spawn).not.toHaveBeenCalled();
    });
  });

  describe('resumeFromDaemonMemory', () => {
    const SAMPLE_DAEMON_SESSION = {
      harnessSessionId: THREAD_ID,
      agentName: 'codex-sdk',
      model: 'gpt-5.6',
      workingDir: '/tmp/resume-wd',
    };

    it('resumes the stored thread id via Codex.resumeThread', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const onSessionIdUpdated = vi.fn();
      const result = await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/resume-wd',
          prompt: createSpawnPrompt('resume hello'),
          systemPrompt: 'sys',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        },
        SAMPLE_DAEMON_SESSION
      );

      result.onHarnessSessionIdUpdated?.(onSessionIdUpdated);
      expect(onSessionIdUpdated).toHaveBeenCalledWith({
        correlationId: result.harnessSessionId,
        resumableId: THREAD_ID,
        source: 'provider_allocated',
      });

      expect(mockResumeThread).toHaveBeenCalledWith(THREAD_ID, {
        workingDirectory: '/tmp/resume-wd',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        model: 'gpt-5.6',
      });
      expect(mockStartThread).not.toHaveBeenCalled();
      expect(deps.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: '/tmp/resume-wd' })
      );

      await vi.waitFor(() => expect(mockRunStreamed).toHaveBeenCalledTimes(1));
      expect(mockRunStreamed.mock.calls[0][0]).toBe('resume hello');
    });

    it('decodes a stored variant on resume', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/resume-wd',
          prompt: createSpawnPrompt('resume hello'),
          systemPrompt: 'sys',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        },
        { ...SAMPLE_DAEMON_SESSION, model: 'gpt-5.6-sol[reasoning=low]' }
      );

      expect(mockResumeThread).toHaveBeenCalledWith(THREAD_ID, {
        workingDirectory: '/tmp/resume-wd',
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        networkAccessEnabled: true,
        model: 'gpt-5.6-sol',
        modelReasoningEffort: 'low',
      });
      expect(mockStartThread).not.toHaveBeenCalled();
    });

    it('falls back to spawn when resume setup fails', async () => {
      const deps = createMockDeps({
        spawn: vi.fn().mockImplementation(() => {
          throw new Error('spawn keeper failed');
        }),
      });
      const service = new CodexSdkAgentService(deps);
      const spawnSpy = vi.spyOn(service, 'spawn').mockResolvedValue({
        pid: 9999,
        harnessSessionId: 'fresh-uuid',
        onExit: vi.fn(),
        onOutput: vi.fn(),
      });

      const result = await service.resumeFromDaemonMemory(
        {
          workingDir: '/tmp/resume-wd',
          prompt: createSpawnPrompt('resume hello'),
          systemPrompt: 'sys',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
        },
        SAMPLE_DAEMON_SESSION
      );

      expect(spawnSpy).toHaveBeenCalledOnce();
      expect(result.pid).toBe(9999);
      spawnSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('aborts the turn, kills the keeper, and fires onExit', async () => {
      stubStream(completedTurnEvents());

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CodexSdkAgentService(deps);

      const onAgentEnd = vi.fn();
      const onExit = vi.fn();

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockRunStreamed).toHaveBeenCalled());
      result.onAgentEnd?.(onAgentEnd);
      result.onExit(onExit);
      await vi.waitFor(() => expect(onAgentEnd).toHaveBeenCalledTimes(1));

      await service.stop(result.pid);

      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
      expect(child.kill).toHaveBeenCalled();
    }, 10_000);
  });
});
