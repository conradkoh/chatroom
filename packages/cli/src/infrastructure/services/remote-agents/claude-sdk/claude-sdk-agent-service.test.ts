import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import {
  ClaudeSdkAgentService,
  resetClaudeSdkModuleCacheForTests,
  type ClaudeSdkAgentServiceDeps,
} from './claude-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const mockQueryFn = vi.fn();
const mockInterruptFn = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQueryFn(...args),
}));

vi.mock('./claude-sdk-package.js', () => ({
  importBundledClaudeSdk: vi.fn(async () => ({
    query: (...args: unknown[]) => mockQueryFn(...args),
  })),
  getBundledClaudeSdkVersion: vi.fn(() => '0.3.195'),
  resolvePathToClaudeCodeExecutable: vi.fn(async () => '/tmp/claude'),
  formatClaudeSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function createMockDeps(overrides?: Partial<ClaudeSdkAgentServiceDeps>): ClaudeSdkAgentServiceDeps {
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

async function* mockSdkMessages(
  messages: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const message of messages) {
    yield message;
  }
}

function stubQuery(messages: Record<string, unknown>[]) {
  const queryInstance = Object.assign(mockSdkMessages(messages), {
    interrupt: mockInterruptFn.mockResolvedValue(undefined),
  });
  mockQueryFn.mockReturnValue(queryInstance);
  return queryInstance;
}

const SPAWN_CONTEXT = { machineId: 'm1', chatroomId: 'c1', role: 'builder' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_SESSION_ID = 'claude-provider-sess-abc';

describe('ClaudeSdkAgentService', () => {
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    resetClaudeSdkModuleCacheForTests();
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockQueryFn.mockReset();
    mockInterruptFn.mockReset();
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
  });

  describe('isInstalled', () => {
    it('returns false when SDK load fails', async () => {
      vi.resetModules();
      vi.doMock('./claude-sdk-package.js', () => ({
        importBundledClaudeSdk: vi.fn(async () => {
          throw new Error('SDK missing');
        }),
        getBundledClaudeSdkVersion: vi.fn(() => '0.3.195'),
        resolvePathToClaudeCodeExecutable: vi.fn(async () => '/tmp/claude'),
        formatClaudeSdkLoadError: (err: unknown) =>
          err instanceof Error ? err.message : String(err),
      }));
      const { ClaudeSdkAgentService: IsolatedService } =
        await import('./claude-sdk-agent-service.js');
      const service = new IsolatedService(createMockDeps());
      expect(await service.isInstalled()).toBe(false);
      vi.resetModules();
    });

    it('returns true when SDK and executable resolve', async () => {
      const service = new ClaudeSdkAgentService(createMockDeps());
      expect(await service.isInstalled()).toBe(true);
    });
  });

  describe('getVersion', () => {
    it('returns pinned SDK semver', async () => {
      const service = new ClaudeSdkAgentService(createMockDeps());
      await expect(service.getVersion()).resolves.toEqual({
        version: '0.3.195',
        major: 0,
      });
    });
  });

  describe('spawn', () => {
    it('registers keeper PID and fires onOutput/onAgentEnd after mocked stream completes', async () => {
      stubQuery([
        { type: 'system', subtype: 'init', session_id: 'sess-1' },
        {
          type: 'stream_event',
          session_id: 'sess-1',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
        },
        { type: 'result', subtype: 'success', session_id: 'sess-1', is_error: false },
      ]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

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
      expect(mockQueryFn).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'do work',
          options: expect.objectContaining({
            systemPrompt: 'you are helpful',
            cwd: '/tmp/work',
            pathToClaudeCodeExecutable: '/tmp/claude',
            maxTurns: 200,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            canUseTool: expect.any(Function),
          }),
        })
      );
    });

    it('deferInitialTurn skips query until resumeTurn', async () => {
      stubQuery([
        { type: 'system', subtype: 'init', session_id: 'sess-1' },
        { type: 'result', subtype: 'success', session_id: 'sess-1', is_error: false },
      ]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });

      expect(result.harnessSessionId).toMatch(UUID_PATTERN);

      await vi.waitFor(() => expect(mockQueryFn).not.toHaveBeenCalled());

      await service.resumeTurn(result.pid, 'injected task');
      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalledTimes(1));
      expect(mockQueryFn.mock.calls[0][0]).toMatchObject({
        prompt: 'injected task',
        options: expect.objectContaining({ systemPrompt: 'you are helpful' }),
      });
    });

    it('assigns distinct harnessSessionId per spawn for concurrent deferred sessions', async () => {
      const childA = makeFakeChild(4321);
      const childB = makeFakeChild(4322);
      const deps = createMockDeps({
        spawn: vi.fn().mockReturnValueOnce(childA).mockReturnValueOnce(childB),
      });
      const service = new ClaudeSdkAgentService(deps);

      const [resultA, resultB] = await Promise.all([
        service.spawn({
          workingDir: '/tmp/work-a',
          prompt: createSpawnPrompt('bootstrap a'),
          systemPrompt: 'you are helpful',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
          deferInitialTurn: true,
        }),
        service.spawn({
          workingDir: '/tmp/work-b',
          prompt: createSpawnPrompt('bootstrap b'),
          systemPrompt: 'you are helpful',
          context: SPAWN_CONTEXT,
          resolvedConvexUrl: 'http://test:3210',
          deferInitialTurn: true,
        }),
      ]);

      expect(resultA.harnessSessionId).toMatch(UUID_PATTERN);
      expect(resultB.harnessSessionId).toMatch(UUID_PATTERN);
      expect(resultA.harnessSessionId).not.toBe(resultB.harnessSessionId);
    });
  });

  describe('deferred harness session ID', () => {
    it('keeps provisional harnessSessionId after provider session_id is captured', async () => {
      stubQuery([
        { type: 'system', subtype: 'init', session_id: PROVIDER_SESSION_ID },
        { type: 'result', subtype: 'success', session_id: PROVIDER_SESSION_ID, is_error: false },
      ]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });

      const provisionalId = result.harnessSessionId;
      expect(provisionalId).toMatch(UUID_PATTERN);

      await service.resumeTurn(result.pid, 'first task');
      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalledTimes(1));

      expect(result.harnessSessionId).toBe(provisionalId);
      expect(result.harnessSessionId).not.toBe(PROVIDER_SESSION_ID);
    });

    it('uses provider session_id for in-process resume on subsequent turns', async () => {
      stubQuery([
        { type: 'system', subtype: 'init', session_id: PROVIDER_SESSION_ID },
        { type: 'result', subtype: 'success', session_id: PROVIDER_SESSION_ID, is_error: false },
      ]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('bootstrap'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
        deferInitialTurn: true,
      });

      await service.resumeTurn(result.pid, 'first task');
      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalledTimes(1));
      expect(mockQueryFn.mock.calls[0][0].options.resume).toBeUndefined();

      stubQuery([
        { type: 'system', subtype: 'init', session_id: PROVIDER_SESSION_ID },
        { type: 'result', subtype: 'success', session_id: PROVIDER_SESSION_ID, is_error: false },
      ]);
      await service.resumeTurn(result.pid, 'second task');
      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalledTimes(2));
      expect(mockQueryFn.mock.calls[1][0]).toMatchObject({
        prompt: 'second task',
        options: expect.objectContaining({ resume: PROVIDER_SESSION_ID }),
      });
    });

    it('canUseTool auto-allows headless tool execution', async () => {
      stubQuery([
        { type: 'result', subtype: 'success', session_id: PROVIDER_SESSION_ID, is_error: false },
      ]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

      await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalled());
      const canUseTool = mockQueryFn.mock.calls[0][0].options.canUseTool as (
        toolName: string,
        input: Record<string, unknown>
      ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      const input = { command: 'ls' };
      await expect(canUseTool('bash', input)).resolves.toEqual({
        behavior: 'allow',
        updatedInput: input,
      });
    });
  });

  describe('stop', () => {
    it('cleans up session and kills keeper', async () => {
      stubQuery([{ type: 'result', subtype: 'success', session_id: 'sess-1', is_error: false }]);

      const child = makeFakeChild();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new ClaudeSdkAgentService(deps);

      const onAgentEnd = vi.fn();
      const onExit = vi.fn();

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: SPAWN_CONTEXT,
        resolvedConvexUrl: 'http://test:3210',
      });

      await vi.waitFor(() => expect(mockQueryFn).toHaveBeenCalled());
      result.onAgentEnd?.(onAgentEnd);
      result.onExit(onExit);
      await vi.waitFor(() => expect(onAgentEnd).toHaveBeenCalledTimes(1));

      await service.stop(result.pid);

      await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
      expect(child.kill).toHaveBeenCalled();
    }, 10_000);
  });
});
