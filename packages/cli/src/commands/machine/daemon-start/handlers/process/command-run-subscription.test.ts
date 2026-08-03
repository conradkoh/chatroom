/**
 * Command-run subscription unit tests.
 *
 * Verifies that startCommandRunSubscription dispatches onCommandRunEffect for
 * new pending runs (and onCommandStopEffect for stop-requested runs) while
 * deduplicating runs already dispatched on subsequent subscription updates.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';
import type { Runtime } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetCommandRunSubscriptionStateForTest,
  startCommandRunSubscription,
} from './command-run-subscription.js';
import type { api, Id } from '../../../../../api.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../../daemon-services.js';
import { onCommandRunEffect, onCommandStopEffect } from '../command-runner.js';

vi.mock('../../../../../api.js', () => ({
  api: {
    daemon: {
      commands: {
        listActionableCommandRuns: 'mock-listActionableCommandRuns',
      },
    },
  },
}));

vi.mock('../command-runner.js', async () => {
  const { Effect } = await import('effect');
  return {
    onCommandRunEffect: vi.fn().mockReturnValue(Effect.void),
    onCommandStopEffect: vi.fn().mockReturnValue(Effect.void),
  };
});

type ActionableCommandRuns = FunctionReturnType<
  typeof api.daemon.commands.listActionableCommandRuns
>;
type UpdateCallback = (result: ActionableCommandRuns | null | undefined) => void;

const mockedOnCommandRunEffect = vi.mocked(onCommandRunEffect);
const mockedOnCommandStopEffect = vi.mocked(onCommandStopEffect);

const FLUSH = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const rid = (id: string): Id<'chatroom_commandRuns'> => id as Id<'chatroom_commandRuns'>;

function makeSession(): DaemonSessionServiceShape {
  return {
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    convexUrl: 'http://test-convex-url',
    client: {} as ConvexClient,
    config: null,
    backend: {} as DaemonSessionServiceShape['backend'],
    fs: {} as DaemonSessionServiceShape['fs'],
    agentServices: new Map(),
    events: {} as DaemonSessionServiceShape['events'],
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

function makeRuntime(session: DaemonSessionServiceShape): Runtime.Runtime<DaemonSessionService> {
  return Effect.runSync(
    Effect.runtime<DaemonSessionService>().pipe(
      Effect.provideService(DaemonSessionService, session)
    )
  );
}

function startSubscription(onUpdate: ReturnType<typeof vi.fn>): {
  callback: UpdateCallback;
  stop: () => void;
} {
  onUpdate.mockReturnValue(vi.fn());
  const wsClient = { onUpdate } as unknown as ConvexClient;
  const handle = startCommandRunSubscription(makeSession(), wsClient, makeRuntime(makeSession()));
  const callback = onUpdate.mock.calls[0]?.[2] as UpdateCallback;
  return { callback, stop: handle.stop };
}

describe('startCommandRunSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCommandRunSubscriptionStateForTest();
  });

  afterEach(() => {
    _resetCommandRunSubscriptionStateForTest();
  });

  it('dispatches onCommandRunEffect for a new pending run', async () => {
    const onUpdate = vi.fn();
    const { callback } = startSubscription(onUpdate);

    expect(onUpdate.mock.calls[0]?.[0]).toBe('mock-listActionableCommandRuns');
    expect(onUpdate.mock.calls[0]?.[1]).toEqual({
      sessionId: 'test-session-id',
      machineId: 'test-machine-id',
    });

    callback({
      pendingRuns: [
        { _id: rid('run-1'), workingDir: '/tmp/ws', commandName: 'dev', script: 'echo hi' },
      ],
      stopRequestedRuns: [],
    });
    await FLUSH();

    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(1);
    expect(mockedOnCommandRunEffect).toHaveBeenCalledWith({
      workingDir: '/tmp/ws',
      commandName: 'dev',
      script: 'echo hi',
      runId: 'run-1',
    });
    expect(mockedOnCommandStopEffect).not.toHaveBeenCalled();
  });

  it('dispatches onCommandStopEffect for a stop-requested running run', async () => {
    const onUpdate = vi.fn();
    const { callback } = startSubscription(onUpdate);

    callback({ pendingRuns: [], stopRequestedRuns: [{ _id: rid('run-9') }] });
    await FLUSH();

    expect(mockedOnCommandStopEffect).toHaveBeenCalledTimes(1);
    expect(mockedOnCommandStopEffect).toHaveBeenCalledWith({ runId: 'run-9' });
    expect(mockedOnCommandRunEffect).not.toHaveBeenCalled();
  });

  it('deduplicates the same pending run on subsequent updates', async () => {
    const onUpdate = vi.fn();
    const { callback } = startSubscription(onUpdate);

    const result: ActionableCommandRuns = {
      pendingRuns: [
        { _id: rid('run-1'), workingDir: '/tmp/ws', commandName: 'dev', script: 'echo hi' },
      ],
      stopRequestedRuns: [],
    };

    callback(result);
    await FLUSH();
    callback(result);
    await FLUSH();

    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(1);

    // A new pending run is still dispatched
    callback({
      pendingRuns: [
        { _id: rid('run-2'), workingDir: '/tmp/ws', commandName: 'build', script: 'echo build' },
      ],
      stopRequestedRuns: [],
    });
    await FLUSH();

    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(2);
  });

  it('deduplicates stop requests for the same run', async () => {
    const onUpdate = vi.fn();
    const { callback } = startSubscription(onUpdate);

    const result: ActionableCommandRuns = {
      pendingRuns: [],
      stopRequestedRuns: [{ _id: rid('run-5') }],
    };

    callback(result);
    await FLUSH();
    callback(result);
    await FLUSH();

    expect(mockedOnCommandStopEffect).toHaveBeenCalledTimes(1);
  });

  it('ignores null/undefined results and empty payloads', async () => {
    const onUpdate = vi.fn();
    const { callback } = startSubscription(onUpdate);

    callback(null);
    callback(undefined);
    callback({ pendingRuns: [], stopRequestedRuns: [] });
    await FLUSH();

    expect(mockedOnCommandRunEffect).not.toHaveBeenCalled();
    expect(mockedOnCommandStopEffect).not.toHaveBeenCalled();
  });

  it('stops dispatching after stop() is called', async () => {
    const onUpdate = vi.fn();
    const { callback, stop } = startSubscription(onUpdate);

    stop();
    expect(onUpdate.mock.calls[0]?.[1]).toBeDefined();
    expect(typeof onUpdate.mock.calls[0]?.[3]).toBe('function');

    callback({
      pendingRuns: [
        { _id: rid('run-1'), workingDir: '/tmp/ws', commandName: 'dev', script: 'echo hi' },
      ],
      stopRequestedRuns: [],
    });
    await FLUSH();

    expect(mockedOnCommandRunEffect).not.toHaveBeenCalled();
  });
});
