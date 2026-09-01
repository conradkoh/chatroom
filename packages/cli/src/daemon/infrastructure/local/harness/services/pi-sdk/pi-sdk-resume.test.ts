import { EventEmitter } from 'node:events';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PiSdkAgentService } from './pi-sdk-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const mockCreateAgentSession = vi.fn();
const mockSessionList = vi.fn();
const mockSessionOpen = vi.fn();

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
      list: (...args: unknown[]) => mockSessionList(...args),
      open: (...args: unknown[]) => mockSessionOpen(...args),
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

function stubAgentSession(sessionId = 'pi-session-1') {
  return {
    sessionId,
    prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

describe('PiSdkAgentService resumeFromDaemonMemory', () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockSessionList.mockReset();
    mockSessionOpen.mockReset();
    mockCreateAgentSession.mockResolvedValue({ session: stubAgentSession() });
    mockSessionList.mockResolvedValue([{ id: 'pi-session-1', path: '/tmp/sess.json' }]);
    mockSessionOpen.mockReturnValue({ resumed: true });
  });

  it('reopens the stored pi session file and prompts on resume', async () => {
    const spawnFn = vi.fn().mockReturnValue(makeFakeChild());
    const service = new PiSdkAgentService({
      execSync: vi.fn(),
      spawn: spawnFn,
      kill: vi.fn(),
    });

    const result = await service.resumeFromDaemonMemory(
      {
        workingDir: '/tmp/work',
        systemPrompt: 'sys',
        prompt: createSpawnPrompt('resume task'),
        model: 'opencode/big-pickle',
        context: { machineId: 'm', chatroomId: 'c', role: 'builder' },
        resolvedConvexUrl: 'http://localhost:3210',
      },
      {
        harnessSessionId: 'pi-session-1',
        agentName: 'builder',
        workingDir: '/tmp/work',
        model: 'opencode/big-pickle',
      }
    );

    expect(mockSessionList).toHaveBeenCalled();
    expect(mockSessionOpen).toHaveBeenCalledWith('/tmp/sess.json', expect.any(String));
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionManager: { resumed: true },
      })
    );
    expect(result.harnessSessionId).toBe('pi-session-1');
  });
});
