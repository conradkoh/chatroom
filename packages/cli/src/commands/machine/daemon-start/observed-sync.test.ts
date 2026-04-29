import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { OBSERVED_SAFETY_POLL_MS } from '@workspace/backend/config/reliability.js';

import { startObservedSyncSubscription } from './observed-sync.js';
import type { DaemonContext } from './types.js';

type ObservedPayload = {
  chatroomId: string;
  workingDirs: string[];
  lastRefreshedAt: number | null;
}[];

vi.mock('./git-heartbeat.js', () => ({
  pushSingleWorkspaceGitSummaryForObserved: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./command-sync-heartbeat.js', () => ({
  pushSingleWorkspaceCommands: vi.fn().mockResolvedValue(undefined),
}));

function makeMockContext(): DaemonContext {
  return {
    client: null,
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: {} as DaemonContext['events'],
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as DaemonContext;
}

function makeObserved(workingDirs: string[], lastRefreshedAt: number | null = null) {
  return [
    {
      chatroomId: 'chatroom-1',
      workingDirs,
      lastRefreshedAt,
    },
  ] satisfies ObservedPayload;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('startObservedSyncSubscription', () => {
  let ctx: DaemonContext;
  let observedCallback: (observed: ObservedPayload) => void;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctx = makeMockContext();
    unsubscribe = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function startSubscription() {
    const wsClient = {
      onUpdate: vi.fn((_query, _args, onUpdate) => {
        observedCallback = onUpdate;
        return unsubscribe;
      }),
    } as unknown as Parameters<typeof startObservedSyncSubscription>[1];

    return startObservedSyncSubscription(ctx, wsClient);
  }

  test('does not poll git or commands when no chatrooms are observed', async () => {
    const { pushSingleWorkspaceGitSummaryForObserved } = await import('./git-heartbeat.js');
    const { pushSingleWorkspaceCommands } = await import('./command-sync-heartbeat.js');

    startSubscription();
    observedCallback([]);

    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS * 3);

    expect(pushSingleWorkspaceGitSummaryForObserved).not.toHaveBeenCalled();
    expect(pushSingleWorkspaceCommands).not.toHaveBeenCalled();
  });

  test('safety poll skips overlapping pushes for the same working directory', async () => {
    const { pushSingleWorkspaceGitSummaryForObserved } = await import('./git-heartbeat.js');
    const observed = makeObserved(['/test/repo']);
    const query = ctx.deps.backend.query as ReturnType<typeof vi.fn>;
    query.mockResolvedValue(observed);

    let resolvePush: () => void = () => undefined;
    vi.mocked(pushSingleWorkspaceGitSummaryForObserved).mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePush = resolve;
      })
    );

    startSubscription();
    observedCallback(observed);

    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS);
    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(1);

    resolvePush();
    await flushPromises();

    vi.mocked(pushSingleWorkspaceGitSummaryForObserved).mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS);

    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(2);
  });

  test('reconcile cleanup stops safety polling for no-longer-observed directories', async () => {
    const { pushSingleWorkspaceGitSummaryForObserved } = await import('./git-heartbeat.js');
    const query = ctx.deps.backend.query as ReturnType<typeof vi.fn>;
    query.mockResolvedValue([]);

    startSubscription();
    observedCallback(makeObserved(['/test/repo']));
    await flushPromises();

    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS);
    await flushPromises();

    expect(query).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS);
    await flushPromises();

    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(1);
  });

  test('stop unsubscribes and clears safety timers', async () => {
    const { pushSingleWorkspaceGitSummaryForObserved } = await import('./git-heartbeat.js');

    const subscription = startSubscription();
    observedCallback(makeObserved(['/test/repo']));
    await flushPromises();

    subscription.stop();
    await vi.advanceTimersByTimeAsync(OBSERVED_SAFETY_POLL_MS);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushSingleWorkspaceGitSummaryForObserved).toHaveBeenCalledTimes(1);
  });
});
