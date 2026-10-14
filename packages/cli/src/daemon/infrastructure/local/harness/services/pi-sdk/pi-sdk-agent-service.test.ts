import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PiSdkAgentService } from './pi-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';
import type { TurnCompletionResult } from '../turn-completion.js';

const mockCreateAgentSession = vi.fn();
const mockModelRuntimeCreate = vi.fn();

type FakeModel = { provider: string; id: string };

/** Minimal ModelRuntime stand-in: every model is both available and resolvable. */
function makeModelRuntime(models: FakeModel[]) {
  return {
    getAvailable: vi.fn(async () => models),
    getModels: vi.fn(() => models),
    getModel: vi.fn((provider: string, modelId: string) =>
      models.find((m) => m.provider === provider && m.id === modelId)
    ),
  };
}

vi.mock('./pi-sdk-package.js', () => ({
  importBundledPiSdk: vi.fn(async () => ({
    ModelRuntime: {
      create: (...args: unknown[]) => mockModelRuntimeCreate(...args),
    },
    createAgentSession: (...args: unknown[]) => mockCreateAgentSession(...args),
    DefaultResourceLoader: vi.fn().mockImplementation(function DefaultResourceLoader() {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    }),
    getAgentDir: vi.fn(() => '/tmp/agent'),
    SessionManager: {
      create: vi.fn().mockReturnValue({}),
    },
  })),
  formatPiSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  getBundledPiSdkVersion: vi.fn(() => '0.55.0'),
}));

function makeFakeChild(pid = 99) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.kill = vi.fn();
  return child;
}

function stubAgentSession() {
  return {
    sessionId: 'pi-session-1',
    prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

describe('PiSdkAgentService', () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockResolvedValue({ session: stubAgentSession() });
    mockModelRuntimeCreate.mockReset();
    mockModelRuntimeCreate.mockResolvedValue(
      makeModelRuntime([{ provider: 'opencode', id: 'big-pickle' }])
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('listModels returns provider/id strings from the model runtime', async () => {
    mockModelRuntimeCreate.mockResolvedValue(
      makeModelRuntime([
        { provider: 'opencode-go', id: 'deepseek-v4.1-flash' },
        { provider: 'opencode', id: 'big-pickle' },
      ])
    );
    const service = new PiSdkAgentService();

    await expect(service.listModels()).resolves.toEqual([
      'opencode-go/deepseek-v4.1-flash',
      'opencode/big-pickle',
    ]);
  });

  it('listModels returns [] when ModelRuntime.create rejects', async () => {
    mockModelRuntimeCreate.mockRejectedValue(new Error('catalog fetch failed'));
    const service = new PiSdkAgentService();

    await expect(service.listModels()).resolves.toEqual([]);
  });

  it('isInstalled is true when at least one model is available', async () => {
    const service = new PiSdkAgentService();

    await expect(service.isInstalled()).resolves.toBe(true);
  });

  it('isInstalled is false when no model is available', async () => {
    mockModelRuntimeCreate.mockResolvedValue(makeModelRuntime([]));
    const service = new PiSdkAgentService();

    await expect(service.isInstalled()).resolves.toBe(false);
  });

  it('isInstalled is false when ModelRuntime.create rejects', async () => {
    mockModelRuntimeCreate.mockRejectedValue(new Error('catalog fetch failed'));
    const service = new PiSdkAgentService();

    await expect(service.isInstalled()).resolves.toBe(false);
  });

  it('passes the model runtime to createAgentSession on spawn', async () => {
    const service = new PiSdkAgentService({
      execSync: vi.fn(),
      spawn: vi.fn().mockReturnValue(makeFakeChild()),
      kill: vi.fn(),
    });

    await service.spawn({
      workingDir: '/tmp',
      systemPrompt: 'sys',
      prompt: createSpawnPrompt('hello'),
      model: 'opencode/big-pickle',
      context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      resolvedConvexUrl: 'http://localhost:3210',
    });

    const runtime = await mockModelRuntimeCreate.mock.results[0]?.value;
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ modelRuntime: runtime })
    );
  });

  it('forwards thinkingLevel from bracket model syntax on spawn', async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeChild());
    const service = new PiSdkAgentService({
      execSync: vi.fn(),
      spawn: spawnFn,
      kill: vi.fn(),
    });

    await service.spawn({
      workingDir: '/tmp',
      systemPrompt: 'sys',
      prompt: createSpawnPrompt('hello'),
      model: 'opencode/big-pickle[thinking=high]',
      context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      resolvedConvexUrl: 'http://localhost:3210',
    });

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: 'opencode', id: 'big-pickle' }),
        thinkingLevel: 'high',
      })
    );
  });

  it('ignores invalid thinking=max', async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeChild());
    const service = new PiSdkAgentService({
      execSync: vi.fn(),
      spawn: spawnFn,
      kill: vi.fn(),
    });

    await service.spawn({
      workingDir: '/tmp',
      systemPrompt: 'sys',
      prompt: createSpawnPrompt('hello'),
      model: 'opencode/big-pickle[thinking=max]',
      context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      resolvedConvexUrl: 'http://localhost:3210',
    });

    const call = mockCreateAgentSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty('thinkingLevel');
    expect(call?.model).toEqual(
      expect.objectContaining({ provider: 'opencode', id: 'big-pickle' })
    );
  });

  it('settles a prompt that resolves after a provider error as failed, not completed', async () => {
    const agentSession = stubAgentSession();
    const sessionListeners: ((event: unknown) => void)[] = [];
    agentSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      sessionListeners.push(listener);
      return () => {};
    });
    agentSession.prompt.mockImplementation(async () => {
      // Provider rejects the request: the assistant message ends in error, then the prompt resolves.
      sessionListeners[0]?.({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'provider 400',
        },
      });
    });
    mockCreateAgentSession.mockResolvedValue({ session: agentSession });
    const service = new PiSdkAgentService({
      execSync: vi.fn(),
      spawn: vi.fn().mockReturnValue(makeFakeChild()),
      kill: vi.fn(),
    });

    const handle = await service.spawn({
      workingDir: '/tmp',
      systemPrompt: 'sys',
      prompt: createSpawnPrompt('hello'),
      model: 'opencode/big-pickle',
      context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
      resolvedConvexUrl: 'http://localhost:3210',
    });
    const results: TurnCompletionResult[] = [];
    expect(handle.onTurnResult).toBeDefined();
    handle.onTurnResult?.((result) => results.push(result));

    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({
      status: 'failed',
      source: 'pi-sdk.prompt.resolved',
      error: 'provider 400',
    });
  });
});
