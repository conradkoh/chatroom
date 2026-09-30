import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onDaemonShutdownEffect } from './on-daemon-shutdown.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';

type Agent = {
  chatroomId: string;
  role: string;
  slot: { pid?: number; workingDir?: string };
};

function runShutdown({
  activeAgents = [],
  stop = vi.fn().mockReturnValue(Effect.succeed({ success: true })),
  recover = vi.fn().mockResolvedValue({ released: 2, skipped: 0 }),
}: {
  activeAgents?: Agent[];
  stop?: ReturnType<typeof vi.fn>;
  recover?: ReturnType<typeof vi.fn>;
} = {}) {
  const session = {
    sessionId: 'session',
    machineId: 'machine',
    taskService: { recoverInFlightTasks: recover },
    backend: { mutation: vi.fn().mockResolvedValue(undefined) },
  };
  const agentPm = {
    listActive: () => activeAgents,
    whenTurnEndsIdle: () => Effect.succeed(undefined),
    stop,
  };
  const effect = Effect.runPromise(
    onDaemonShutdownEffect.pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(DaemonAgentProcessManagerService, agentPm as never),
          Layer.succeed(DaemonSessionService, session as never)
        )
      )
    )
  );
  return { effect, stop, recover, session };
}

describe('onDaemonShutdownEffect', () => {
  afterEach(() => vi.restoreAllMocks());

  test('confirms all direct manager stops before automatic recovery', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stop = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const recover = vi.fn().mockImplementation(async () => ({ released: 2, skipped: 0 }));
    const { effect, session } = runShutdown({
      activeAgents: [
        { chatroomId: 'room-a', role: 'planner', slot: { pid: 101, workingDir: '/a' } },
        { chatroomId: 'room-b', role: 'builder', slot: { pid: 202, workingDir: '/b' } },
      ],
      stop,
      recover,
    });
    await effect;

    expect(stop).toHaveBeenNthCalledWith(1, {
      chatroomId: 'room-a',
      role: 'planner',
      reason: 'daemon.shutdown',
      pid: 101,
      workingDir: '/a',
    });
    expect(stop).toHaveBeenNthCalledWith(2, {
      chatroomId: 'room-b',
      role: 'builder',
      reason: 'daemon.shutdown',
      pid: 202,
      workingDir: '/b',
    });
    expect(stop.mock.invocationCallOrder[1]).toBeLessThan(recover.mock.invocationCallOrder[0]);
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith({ mode: 'automatic' });
    expect(log.mock.calls.flat().join(' ')).toContain('Shutdown stops: 2 stopped');
    expect(log.mock.calls.flat().join(' ')).toContain('Released 2 in-flight task(s) to pending');
    // The only backend mutation in this fixture is the best-effort offline marker.
    expect(session.backend.mutation).toHaveBeenCalledTimes(1);
  });

  test('recovers automatically when there are no local active slots', async () => {
    const { effect, stop, recover } = runShutdown({ activeAgents: [] });
    await effect;
    expect(stop).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith({ mode: 'automatic' });
  });

  test('skips all recovery when a stop throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi.fn().mockReturnValue(Effect.fail(new Error('process unavailable')));
    const recover = vi.fn();
    const { effect } = runShutdown({
      activeAgents: [{ chatroomId: 'room', role: 'planner', slot: {} }],
      stop,
      recover,
    });
    await effect;
    expect(recover).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'Skipped task recovery because 1 agent stop(s) failed'
    );
  });

  test('continues stopping agents after a rejected stop promise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi
      .fn()
      .mockReturnValueOnce(Effect.promise(() => Promise.reject(new Error('process unavailable'))))
      .mockReturnValueOnce(Effect.succeed({ success: true }));
    const recover = vi.fn();
    const { effect, session } = runShutdown({
      activeAgents: [
        { chatroomId: 'room-a', role: 'planner', slot: { pid: 101, workingDir: '/a' } },
        { chatroomId: 'room-b', role: 'builder', slot: { pid: 202, workingDir: '/b' } },
      ],
      stop,
      recover,
    });

    await expect(effect).resolves.toBeUndefined();

    expect(stop).toHaveBeenCalledTimes(2);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(stop.mock.invocationCallOrder[1]);
    expect(recover).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('planner@room-a');
    expect(warn.mock.calls.flat().join(' ')).toContain('process unavailable');
    expect(session.backend.mutation).toHaveBeenCalledTimes(1);
  });

  test('skips all recovery when a stop returns success false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi.fn().mockReturnValue(Effect.succeed({ success: false }));
    const recover = vi.fn();
    const { effect } = runShutdown({
      activeAgents: [{ chatroomId: 'room', role: 'planner', slot: {} }],
      stop,
      recover,
    });
    await effect;
    expect(recover).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('stop was not confirmed');
  });

  test('logs recovery failure after confirmed stops and continues shutdown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const recover = vi.fn().mockRejectedValue(new Error('backend down'));
    const { effect } = runShutdown({
      activeAgents: [{ chatroomId: 'room', role: 'planner', slot: {} }],
      stop,
      recover,
    });
    await expect(effect).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith({ mode: 'automatic' });
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'Failed to recover in-flight tasks on shutdown: backend down'
    );
  });
});
