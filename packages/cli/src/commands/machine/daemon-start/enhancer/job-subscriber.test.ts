import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../api.js', () => {
  const api: Record<string, unknown> = {};
  // Build a nested object structure mimicking Convex API paths
  const setPath = (obj: Record<string, unknown>, path: string[], value: string) => {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
  };
  setPath(api, ['daemon', 'enhancer', 'index', 'claimForSpawn'], 'claimForSpawn');
  setPath(api, ['daemon', 'enhancer', 'index', 'getSpawnPayload'], 'getSpawnPayload');
  setPath(api, ['web', 'enhancer', 'index', 'recordAttemptFailure'], 'recordAttemptFailure');
  setPath(api, ['web', 'enhancer', 'index', 'getJob'], 'getJob');
  setPath(api, ['daemon', 'enhancer', 'index', 'pendingForMachine'], 'pendingForMachine');
  return { api };
});

import { startEnhancerJobSubscriber } from './job-subscriber.js';

describe('startEnhancerJobSubscriber', () => {
  it('records attempt failure when harness exits without completing job', async () => {
    vi.useFakeTimers();

    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const mutationFn = vi.fn().mockImplementation((endpoint: string, args: unknown) => {
      if (endpoint === 'claimForSpawn') return { claimed: true };
      if (endpoint === 'recordAttemptFailure') return recordFailure(args);
      return undefined;
    });
    const queryFn = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === 'getSpawnPayload') {
        return {
          chatroomId: 'room1',
          jobId: 'job1',
          agentHarness: 'opencode',
          model: 'm',
          workingDir: '/tmp',
          systemPrompt: 'sys',
          taskEnvelope: 'task',
        };
      }
      return { status: 'running' };
    });

    const backend = {
      mutation: mutationFn,
      query: queryFn,
    };

    let onUpdateCb: (jobs: unknown[]) => void = () => {};
    const wsClient = {
      onUpdate: vi.fn((_api: unknown, _args: unknown, cb: (jobs: unknown[]) => void) => {
        onUpdateCb = cb;
        return vi.fn();
      }),
    };

    let exitCallback: (() => void) | undefined;
    const spawn = vi.fn().mockReturnValue({
      onExit: (fn: () => void) => {
        exitCallback = fn;
      },
      onLogLine: vi.fn(),
      onAssistantText: vi.fn(),
    });
    const agentServices = new Map([['opencode', { spawn }]]);

    startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      backend as any,
      wsClient as any,
      agentServices as any
    );

    // Trigger the onUpdate callback with a job
    onUpdateCb([{ jobId: 'job1', chatroomId: 'room1' }]);

    // Let the async handler claim the job and spawn
    await vi.advanceTimersByTimeAsync(10);

    // Simulate harness exit — the subscriber waits on onExit, so call callback
    exitCallback!();

    await vi.advanceTimersByTimeAsync(10);

    // Verify recordAttemptFailure was called
    expect(recordFailure).toHaveBeenCalled();
    const callArgs = recordFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.error).toBe('Agent exited without completing enhancer job');

    vi.useRealTimers();
  });
});
