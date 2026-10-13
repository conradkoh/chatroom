import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeWorkspaceService } from './testing/index.js';
import { DEFAULT_WORKSPACE_SYNC_POLICY } from '../services/workspace-service/domain/workspace-sync-policy.js';

const registerCommandInboundHandler = vi.fn();
const unregisterCommandInboundHandler = vi.fn();
const registerFileInboundHandler = vi.fn();
const unregisterFileInboundHandler = vi.fn();
const registerWorkspaceGitInboundHandler = vi.fn();
const unregisterWorkspaceGitInboundHandler = vi.fn();
const drainPendingFileTreeReleaseRequests = vi.fn().mockResolvedValue(undefined);
const taskInboxStop = vi.fn();
const workspaceStateOutboxFlush = vi.fn().mockResolvedValue(undefined);
const workspaceStateOutboxStop = vi.fn().mockResolvedValue(undefined);
const shutdownEffectStarted = vi.fn();
const livenessSweepStart = vi.fn();
const livenessSweepStop = vi.fn();
const nativeDelivery = {
  dispose: vi.fn(),
  agentTaskState: { clearAll: vi.fn() },
};

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
vi.mock('./task-inbox-runtime.js', async () => {
  const { Effect } = await import('effect');
  return {
    startTaskInboxEffect: () => Effect.succeed({ stop: taskInboxStop, nativeDelivery }),
  };
});

vi.mock('./workspace-git/git-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startGitRequestSubscriptionEffect: () =>
      Effect.succeed({ stop: vi.fn(), drainPendingGitRequests: vi.fn() }),
  };
});
vi.mock('./files/file-tree-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startFileTreeSubscriptionEffect: () =>
      Effect.succeed({
        stop: vi.fn(),
        drainPendingFileTreeRequests: vi.fn(),
        drainPendingFileTreeReleaseRequests,
      }),
  };
});
vi.mock('./handlers/process/log-observer-sync.js', () => ({
  startLogObserverSubscription: () => ({ stop: vi.fn() }),
}));
vi.mock('../../commands/machine/pid.js', () => ({
  releaseLock: vi.fn(),
}));
vi.mock('../../events/lifecycle/on-daemon-shutdown.js', async () => {
  const { Effect } = await import('effect');
  return { onDaemonShutdownEffect: Effect.sync(shutdownEffectStarted) };
});

describe('createDaemonRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A test may leave a pending stop behind; each test sets the stop it needs.
    taskInboxStop.mockReset();
  });

  /** Builds the runtime, starts it, and resolves once the inbound handlers are registered. */
  async function startRuntime() {
    const { Effect, Layer } = await import('effect');
    const {
      AgentLifecycleOutboxService,
      DaemonSessionService,
      DaemonMutableStateService,
      DaemonAgentProcessManagerCommandService,
      DaemonAgentProcessManagerService,
    } = await import('./daemon-services.js');
    const { createDaemonRuntime } = await import('./daemon-runtime.js');

    const workspaceService = createFakeWorkspaceService();
    const session = {
      sessionId: 's1' as const,
      machineId: 'm1',
      backend: { mutation: vi.fn(), query: vi.fn() },
      convexUrl: 'https://example.com',
      agentServices: new Map(),
      workspaceService,
    };

    const layers = Layer.mergeAll(
      Layer.succeed(DaemonSessionService, session as never),
      Layer.succeed(DaemonMutableStateService, {} as never),
      Layer.succeed(DaemonAgentProcessManagerService, {
        startLivenessSweep: livenessSweepStart,
        stopLivenessSweep: livenessSweepStop,
      } as never),
      Layer.succeed(DaemonAgentProcessManagerCommandService, {
        runSerializedForAgent: vi.fn(),
      } as never),
      Layer.succeed(AgentLifecycleOutboxService, {
        enqueue: () => Effect.succeed({ success: true }),
        stopAll: () => Effect.void,
      })
    );

    const onNativeDeliveryReady = vi.fn();
    const runtime = createDaemonRuntime({
      wsClient: { onUpdate: vi.fn() } as never,
      agentLifecycleOutbox: {
        stopAll: vi.fn().mockResolvedValue(undefined),
      } as never,
      workspaceStateOutbox: {
        flushNow: workspaceStateOutboxFlush,
        stopAll: workspaceStateOutboxStop,
      } as never,
      agentProcessManagerService: {
        stopProcessing: vi.fn().mockResolvedValue(undefined),
      } as never,
      layers,
      onNativeDeliveryReady,
    });

    const runPromise = runtime.run();
    await new Promise((r) => setTimeout(r, 50));
    return { runtime, runPromise, workspaceService, onNativeDeliveryReady };
  }

  it('registers inbound handlers on run and unregisters on shutdown', async () => {
    const { runtime, runPromise, workspaceService, onNativeDeliveryReady } = await startRuntime();

    expect(registerCommandInboundHandler).toHaveBeenCalled();
    expect(registerFileInboundHandler).toHaveBeenCalled();
    expect(registerWorkspaceGitInboundHandler).toHaveBeenCalled();
    expect(onNativeDeliveryReady).toHaveBeenCalledWith(nativeDelivery);
    expect(registerFileInboundHandler).toHaveBeenCalledBefore(drainPendingFileTreeReleaseRequests);
    expect(drainPendingFileTreeReleaseRequests).toHaveBeenCalledTimes(1);
    expect(workspaceService.start).toHaveBeenCalledTimes(1);

    let resolveTaskInboxStop!: () => void;
    taskInboxStop.mockImplementation(
      () => new Promise<void>((resolve) => (resolveTaskInboxStop = resolve))
    );
    const shutdownPromise = runtime.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(taskInboxStop).toHaveBeenCalledOnce();
    expect(shutdownEffectStarted).not.toHaveBeenCalled();
    resolveTaskInboxStop();
    await shutdownPromise;
    await runPromise;

    // Monitors stop before the workspace-state outbox is flushed and stopped.
    expect(workspaceService.stopAll).toHaveBeenCalledBefore(workspaceStateOutboxFlush);
    expect(workspaceStateOutboxFlush).toHaveBeenCalledBefore(workspaceStateOutboxStop);
    expect(unregisterCommandInboundHandler).toHaveBeenCalled();
    expect(unregisterFileInboundHandler).toHaveBeenCalled();
    expect(unregisterWorkspaceGitInboundHandler).toHaveBeenCalled();
    expect(onNativeDeliveryReady).toHaveBeenLastCalledWith(null);
    expect(shutdownEffectStarted).toHaveBeenCalledOnce();
  });

  it('starts the liveness sweep before the workspace service and stops it before the monitors', async () => {
    const { runtime, runPromise, workspaceService } = await startRuntime();

    expect(livenessSweepStart).toHaveBeenCalledTimes(1);
    expect(livenessSweepStart).toHaveBeenCalledBefore(vi.mocked(workspaceService.start));

    await runtime.shutdown();
    await runPromise;

    expect(livenessSweepStop).toHaveBeenCalledTimes(1);
    expect(livenessSweepStop).toHaveBeenCalledBefore(vi.mocked(workspaceService.stopAll));
  });

  it('gives up on a flush that never settles after shutdownFlushTimeoutMs, then stops the outbox', async () => {
    const { runtime, runPromise } = await startRuntime();
    workspaceStateOutboxFlush.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const flushTimeoutMs = DEFAULT_WORKSPACE_SYNC_POLICY.outbox.shutdownFlushTimeoutMs;

    // Only the timers are faked, so the shutdown's promise chain still runs for real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const shutdownPromise = runtime.shutdown();
      await vi.advanceTimersByTimeAsync(flushTimeoutMs - 1);
      expect(workspaceStateOutboxFlush).toHaveBeenCalledOnce();
      expect(workspaceStateOutboxStop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(workspaceStateOutboxStop).toHaveBeenCalledOnce();

      await shutdownPromise;
    } finally {
      vi.useRealTimers();
    }
    await runPromise;
  });
});
