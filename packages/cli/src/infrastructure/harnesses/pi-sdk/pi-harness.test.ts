import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PiSdkHarness, startPiSdkHarness } from './index.js';

const mockCreateAgentSession = vi.fn();
const mockSessionManagerList = vi.fn();
const mockSessionManagerCreate = vi.fn();
const mockGetAvailable = vi.fn();

vi.mock('../../services/remote-agents/pi-sdk/pi-sdk-package.js', () => ({
  importBundledPiSdk: vi.fn(async () => ({
    AuthStorage: { create: vi.fn() },
    ModelRegistry: {
      create: vi.fn(() => ({
        getAvailable: mockGetAvailable,
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
      create: (...args: unknown[]) => mockSessionManagerCreate(...args),
      list: (...args: unknown[]) => mockSessionManagerList(...args),
      open: vi.fn(),
    },
  })),
  formatPiSdkLoadError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

function stubPiSession(sessionId = 'pi-session-1') {
  const session = {
    sessionId,
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
  mockCreateAgentSession.mockResolvedValue({ session });
  return session;
}

describe('PiSdkHarness', () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockGetAvailable.mockReset();
    mockGetAvailable.mockReturnValue([{ provider: 'opencode', id: 'big-pickle' }]);
    mockSessionManagerCreate.mockReturnValue({});
  });

  it('lists a single primary builder agent', async () => {
    const { AuthStorage, ModelRegistry } =
      await import('../../services/remote-agents/pi-sdk/pi-sdk-package.js').then((m) =>
        m.importBundledPiSdk()
      );
    const harness = new PiSdkHarness(
      '/tmp/work',
      ModelRegistry.create(AuthStorage.create()),
      AuthStorage.create()
    );
    const agents = await harness.listAgents();
    expect(agents).toEqual([{ name: 'builder', mode: 'primary' }]);
  });

  it('creates a session via createAgentSession', async () => {
    stubPiSession();
    const { AuthStorage, ModelRegistry } =
      await import('../../services/remote-agents/pi-sdk/pi-sdk-package.js').then((m) =>
        m.importBundledPiSdk()
      );
    const harness = new PiSdkHarness(
      '/tmp/work',
      ModelRegistry.create(AuthStorage.create()),
      AuthStorage.create()
    );
    const session = await harness.newSession({ model: 'opencode/big-pickle' });
    expect(mockCreateAgentSession).toHaveBeenCalled();
    expect(session.opencodeSessionId).toBe('pi-session-1');
    await harness.close();
  });

  it('startPiSdkHarness fails when no models available', async () => {
    mockGetAvailable.mockReturnValue([]);
    await expect(
      startPiSdkHarness({
        harnessName: 'pi-sdk',
        workingDir: '/tmp',
        workspaceId: 'ws-1',
        resolvedConvexUrl: 'http://test:3210',
      })
    ).rejects.toThrow('No Pi models available');
  });
});
