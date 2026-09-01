import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PiSdkAgentService } from './pi-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const mockCreateAgentSession = vi.fn();

vi.mock('./pi-sdk-package.js', () => ({
  importBundledPiSdk: vi.fn(async () => ({
    AuthStorage: { create: vi.fn() },
    ModelRegistry: {
      create: vi.fn(() => ({
        getAvailable: vi.fn(() => [{ provider: 'opencode', id: 'big-pickle' }]),
        getAll: vi.fn(() => [{ provider: 'opencode', id: 'big-pickle' }]),
        find: vi.fn((provider: string, modelId: string) =>
          provider === 'opencode' && modelId === 'big-pickle'
            ? { provider, id: modelId }
            : undefined
        ),
      })),
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
});
