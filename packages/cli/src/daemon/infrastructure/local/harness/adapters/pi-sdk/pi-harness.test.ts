import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PiSdkHarness, startPiSdkHarness } from './index.js';
import { importBundledPiSdk } from '../../services/pi-sdk/pi-sdk-package.js';

const mockCreateAgentSession = vi.fn();
const mockSessionManagerList = vi.fn();
const mockSessionManagerCreate = vi.fn();
const mockSessionManagerOpen = vi.fn();
const mockGetAvailable = vi.fn();

vi.mock('../../services/pi-sdk/pi-sdk-package.js', () => ({
  importBundledPiSdk: vi.fn(async () => ({
    ModelRuntime: {
      create: vi.fn(async () => ({
        getAvailable: mockGetAvailable,
        getModels: vi.fn(() => [{ provider: 'opencode', id: 'big-pickle' }]),
        getModel: vi.fn((provider: string, modelId: string) =>
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
      open: (...args: unknown[]) => mockSessionManagerOpen(...args),
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

/** Builds a harness the same way startPiSdkHarness does: from a ModelRuntime. */
async function createHarness(): Promise<PiSdkHarness> {
  const { ModelRuntime } = await importBundledPiSdk();
  return new PiSdkHarness('/tmp/work', await ModelRuntime.create());
}

describe('PiSdkHarness', () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockSessionManagerList.mockReset();
    mockSessionManagerOpen.mockReset();
    mockGetAvailable.mockReset();
    mockGetAvailable.mockResolvedValue([{ provider: 'opencode', id: 'big-pickle' }]);
    mockSessionManagerCreate.mockReturnValue({});
    mockSessionManagerOpen.mockReturnValue({});
  });

  it('lists a single primary builder agent', async () => {
    const harness = await createHarness();
    const agents = await harness.listAgents();
    expect(agents).toEqual([{ name: 'builder', mode: 'primary' }]);
  });

  it('models() lists provider/id strings from the available models', async () => {
    mockGetAvailable.mockResolvedValue([
      { provider: 'opencode-go', id: 'deepseek-v4.1-flash' },
      { provider: 'opencode', id: 'big-pickle' },
    ]);
    const harness = await createHarness();

    const models = await harness.models();

    expect(models.map((m) => m.id)).toEqual([
      'opencode-go/deepseek-v4.1-flash',
      'opencode/big-pickle',
    ]);
  });

  it('creates a session via createAgentSession', async () => {
    stubPiSession();
    const harness = await createHarness();
    const session = await harness.newSession({ model: 'opencode/big-pickle' });
    expect(mockCreateAgentSession).toHaveBeenCalled();
    expect(session.opencodeSessionId).toBe('pi-session-1');
    await harness.close();
  });

  it('passes the model runtime to createAgentSession', async () => {
    stubPiSession();
    const harness = await createHarness();
    await harness.newSession({ model: 'opencode/big-pickle' });
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ modelRuntime: expect.any(Object) })
    );
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelRegistry: expect.anything() })
    );
    await harness.close();
  });

  it('forwards thinkingLevel from bracket model syntax', async () => {
    stubPiSession();
    const harness = await createHarness();
    await harness.newSession({ model: 'opencode/big-pickle[thinking=xhigh]' });
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: 'opencode', id: 'big-pickle' }),
        thinkingLevel: 'xhigh',
      })
    );
    await harness.close();
  });

  it('resumeSession omits model and thinkingLevel for SDK session-file restore', async () => {
    stubPiSession('resumed-session');
    mockSessionManagerList.mockResolvedValue([
      { id: 'sess-1', path: '/tmp/sess.jsonl', name: 'test' },
    ]);
    const harness = await createHarness();

    await harness.resumeSession('sess-1' as never);

    const call = mockCreateAgentSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty('model');
    expect(call).not.toHaveProperty('thinkingLevel');
    expect(mockSessionManagerOpen).toHaveBeenCalled();
    await harness.close();
  });

  it('resumeSession forwards thinkingLevel from options.model bracket syntax', async () => {
    stubPiSession('resumed-session');
    mockSessionManagerList.mockResolvedValue([
      { id: 'sess-1', path: '/tmp/sess.jsonl', name: 'test' },
    ]);
    const harness = await createHarness();

    await harness.resumeSession('sess-1' as never, {
      model: 'opencode/big-pickle[thinking=xhigh]',
    });

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: 'opencode', id: 'big-pickle' }),
        thinkingLevel: 'xhigh',
      })
    );
    await harness.close();
  });

  it('startPiSdkHarness fails when no models available', async () => {
    mockGetAvailable.mockResolvedValue([]);
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
