/**
 * Command-run subscription unit tests.
 *
 * Verifies processActionableCommandRuns / drainActionableCommandRuns dispatch
 * while deduplicating runs already dispatched.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';
import type { Runtime } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetCommandRunSubscriptionStateForTest,
  drainActionableCommandRuns,
  processActionableCommandRuns,
  startCommandRunSubscription,
} from './command-run-subscription.js';
import type { api, Id } from '../../../../api.js';
import {
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from '../../../../commands/machine/daemon-start/daemon-services.js';
import { onCommandRunEffect, onCommandStopEffect } from '../command-runner.js';

vi.mock('../../../../api.js', () => ({
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

const mockedOnCommandRunEffect = vi.mocked(onCommandRunEffect);
const mockedOnCommandStopEffect = vi.mocked(onCommandStopEffect);

const FLUSH = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const rid = (id: string): Id<'chatroom_commandRunsV2'> => id as Id<'chatroom_commandRunsV2'>;

function makeSession(): DaemonSessionServiceShape {
  return {
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    convexUrl: 'http://test-convex-url',
    client: {} as ConvexClient,
    config: null,
    backend: {
      query: vi.fn(),
      mutation: vi.fn(),
    } as DaemonSessionServiceShape['backend'],
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

describe('processActionableCommandRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCommandRunSubscriptionStateForTest();
  });

  afterEach(() => {
    _resetCommandRunSubscriptionStateForTest();
  });

  it('dispatches onCommandRunEffect for a new pending run', async () => {
    const session = makeSession();
    const runtime = makeRuntime(session);

    processActionableCommandRuns(session, runtime, {
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
    const session = makeSession();
    const runtime = makeRuntime(session);

    processActionableCommandRuns(session, runtime, {
      pendingRuns: [],
      stopRequestedRuns: [{ _id: rid('run-9') }],
    });
    await FLUSH();

    expect(mockedOnCommandStopEffect).toHaveBeenCalledTimes(1);
    expect(mockedOnCommandStopEffect).toHaveBeenCalledWith({ runId: 'run-9' });
    expect(mockedOnCommandRunEffect).not.toHaveBeenCalled();
  });

  it('deduplicates the same pending run on subsequent updates', async () => {
    const session = makeSession();
    const runtime = makeRuntime(session);

    const result: ActionableCommandRuns = {
      pendingRuns: [
        { _id: rid('run-1'), workingDir: '/tmp/ws', commandName: 'dev', script: 'echo hi' },
      ],
      stopRequestedRuns: [],
    };

    processActionableCommandRuns(session, runtime, result);
    await FLUSH();
    processActionableCommandRuns(session, runtime, result);
    await FLUSH();

    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(1);

    processActionableCommandRuns(session, runtime, {
      pendingRuns: [
        { _id: rid('run-2'), workingDir: '/tmp/ws', commandName: 'build', script: 'echo build' },
      ],
      stopRequestedRuns: [],
    });
    await FLUSH();

    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(2);
  });
});

describe('drainActionableCommandRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCommandRunSubscriptionStateForTest();
  });

  it('queries backend and dispatches actionable runs', async () => {
    const session = makeSession();
    vi.mocked(session.backend.query).mockResolvedValue({
      pendingRuns: [
        { _id: rid('run-1'), workingDir: '/tmp/ws', commandName: 'dev', script: 'echo hi' },
      ],
      stopRequestedRuns: [],
    });
    const runtime = makeRuntime(session);

    await drainActionableCommandRuns(session, runtime);
    await FLUSH();

    expect(session.backend.query).toHaveBeenCalledWith('mock-listActionableCommandRuns', {
      sessionId: 'test-session-id',
      machineId: 'test-machine-id',
    });
    expect(mockedOnCommandRunEffect).toHaveBeenCalledTimes(1);
  });
});

describe('startCommandRunSubscription', () => {
  it('returns a noop stop handle (WS removed in U13)', () => {
    const handle = startCommandRunSubscription();
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });
});
