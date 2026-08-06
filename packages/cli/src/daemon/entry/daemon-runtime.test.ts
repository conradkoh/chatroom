import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerCommandInboundHandler = vi.fn();
const unregisterCommandInboundHandler = vi.fn();
const registerFileInboundHandler = vi.fn();
const unregisterFileInboundHandler = vi.fn();
const registerWorkspaceGitInboundHandler = vi.fn();
const unregisterWorkspaceGitInboundHandler = vi.fn();

vi.mock('./command-inbound-registry.js', () => ({
  registerCommandInboundHandler,
  unregisterCommandInboundHandler,
}));
vi.mock('./file-inbound-registry.js', () => ({
  registerFileInboundHandler,
  unregisterFileInboundHandler,
}));
vi.mock('./workspace-git-inbound-registry.js', () => ({
  registerWorkspaceGitInboundHandler,
  unregisterWorkspaceGitInboundHandler,
}));

vi.mock('./workspace-git/git-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startGitRequestSubscriptionEffect: () =>
      Effect.succeed({ stop: vi.fn(), drainPendingGitRequests: vi.fn() }),
  };
});
vi.mock('../../commands/machine/daemon-start/file-tree-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startFileTreeSubscriptionEffect: () =>
      Effect.succeed({ stop: vi.fn(), drainPendingFileTreeRequests: vi.fn() }),
  };
});
vi.mock('../../commands/machine/daemon-start/workspace-list-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startWorkspaceListSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
    reconcileWorkspaceList: vi.fn(),
  };
});
vi.mock('./task-monitor-runtime.js', async () => {
  const { Effect } = await import('effect');
  return {
    startTaskMonitorEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});
vi.mock('../../commands/machine/daemon-start/handlers/process/log-observer-sync.js', () => ({
  startLogObserverSubscription: () => ({ stop: vi.fn() }),
}));
vi.mock('../../commands/machine/pid.js', () => ({
  releaseLock: vi.fn(),
}));
vi.mock('../../events/lifecycle/on-daemon-shutdown.js', async () => {
  const { Effect } = await import('effect');
  return { onDaemonShutdownEffect: Effect.void };
});

describe('createDaemonRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers inbound handlers on run and unregisters on shutdown', async () => {
    const { Layer } = await import('effect');
    const { DaemonSessionService, DaemonMutableStateService, DaemonAgentProcessManagerService } =
      await import('../../commands/machine/daemon-start/daemon-services.js');
    const { createDaemonRuntime } = await import('./daemon-runtime.js');

    const session = {
      sessionId: 's1' as const,
      machineId: 'm1',
      backend: { mutation: vi.fn(), query: vi.fn() },
      convexUrl: 'https://example.com',
      agentServices: new Map(),
    };

    const layers = Layer.mergeAll(
      Layer.succeed(DaemonSessionService, session as never),
      Layer.succeed(DaemonMutableStateService, {
        lastPushedGitState: { get: vi.fn(), set: vi.fn() },
      } as never),
      Layer.succeed(DaemonAgentProcessManagerService, {} as never)
    );

    const runtime = createDaemonRuntime({
      wsClient: { onUpdate: vi.fn() } as never,
      layers,
    });

    const runPromise = runtime.run();
    await new Promise((r) => setTimeout(r, 50));

    expect(registerCommandInboundHandler).toHaveBeenCalled();
    expect(registerFileInboundHandler).toHaveBeenCalled();
    expect(registerWorkspaceGitInboundHandler).toHaveBeenCalled();

    await runtime.shutdown();
    await runPromise;

    expect(unregisterCommandInboundHandler).toHaveBeenCalled();
    expect(unregisterFileInboundHandler).toHaveBeenCalled();
    expect(unregisterWorkspaceGitInboundHandler).toHaveBeenCalled();
  });
});
