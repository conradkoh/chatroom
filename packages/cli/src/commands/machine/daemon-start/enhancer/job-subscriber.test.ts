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
  setPath(api, ['web', 'enhancer', 'index', 'complete'], 'complete');
  setPath(api, ['web', 'enhancer', 'index', 'getJob'], 'getJob');
  setPath(api, ['daemon', 'enhancer', 'index', 'pendingForMachine'], 'pendingForMachine');
  return { api };
});

import { startEnhancerJobSubscriber } from './job-subscriber.js';

describe('startEnhancerJobSubscriber', () => {
  it('records attempt failure when harness exits without completing job', async () => {
    vi.useFakeTimers();

    let getJobCalls = 0;
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
      getJobCalls++;
      return Promise.resolve({ status: 'running' });
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
      pid: 123,
    });
    const agentServices = new Map([['opencode', { spawn, stop: vi.fn() }]]);

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

    // Simulate harness exit — triggers onExit in waitForEnhancerJobResolution
    exitCallback!();

    await vi.runAllTimersAsync();

    // Verify recordAttemptFailure was called
    expect(recordFailure).toHaveBeenCalled();
    const callArgs = recordFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.error).toBe('Agent process exited without completing enhancer job');

    vi.useRealTimers();
  });

  it('agent_end triggers forceTerminal failure', async () => {
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
      return Promise.resolve({ status: 'running' });
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

    let agentEndCallback: (() => void) | undefined;
    const spawn = vi.fn().mockReturnValue({
      onExit: vi.fn(),
      onAgentEnd: (fn: () => void) => {
        agentEndCallback = fn;
      },
      onLogLine: vi.fn(),
      onAssistantText: vi.fn(),
      pid: 123,
    });
    const agentServices = new Map([['opencode', { spawn, stop: vi.fn() }]]);

    startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      backend as any,
      wsClient as any,
      agentServices as any
    );

    onUpdateCb([{ jobId: 'job1', chatroomId: 'room1' }]);

    await vi.advanceTimersByTimeAsync(10);

    // Fire agent_end
    agentEndCallback!();

    await vi.runAllTimersAsync();

    expect(recordFailure).toHaveBeenCalled();
    const callArgs = recordFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.error).toBe('Agent exited without completing enhancer job');
    expect(callArgs.forceTerminal).toBe(true);

    vi.useRealTimers();
  });

  it('agent_end with assistant text salvages via complete mutation', async () => {
    vi.useFakeTimers();

    let salvaged = false;
    const completeFn = vi.fn().mockImplementation(async () => {
      salvaged = true;
    });
    const recordFailure = vi.fn();
    const mutationFn = vi.fn().mockImplementation((endpoint: string, args: unknown) => {
      if (endpoint === 'claimForSpawn') return { claimed: true };
      if (endpoint === 'complete') return completeFn(args);
      if (endpoint === 'recordAttemptFailure') return recordFailure(args);
      return undefined;
    });
    const queryFn = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === 'getSpawnPayload') {
        return Promise.resolve({
          chatroomId: 'room1',
          jobId: 'job1',
          agentHarness: 'opencode',
          model: 'm',
          workingDir: '/tmp',
          systemPrompt: 'sys',
          taskEnvelope: 'task',
        });
      }
      return Promise.resolve({ status: salvaged ? 'complete' : 'running' });
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

    let agentEndCallback: (() => void) | undefined;
    let assistantTextCallback: ((text: string) => void) | undefined;
    const spawn = vi.fn().mockReturnValue({
      onExit: vi.fn(),
      onAgentEnd: (fn: () => void) => {
        agentEndCallback = fn;
      },
      onAssistantText: (fn: (text: string) => void) => {
        assistantTextCallback = fn;
      },
      onLogLine: vi.fn(),
      pid: 123,
    });
    const agentServices = new Map([['opencode', { spawn, stop: vi.fn() }]]);

    startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      backend as any,
      wsClient as any,
      agentServices as any
    );

    onUpdateCb([{ jobId: 'job1', chatroomId: 'room1' }]);
    await vi.advanceTimersByTimeAsync(10);

    // Simulate assistant text deltas
    assistantTextCallback!('## Summary\n');
    assistantTextCallback!('Planning feedback');

    // Fire agent_end
    agentEndCallback!();
    await vi.runAllTimersAsync();

    // Assert complete called with accumulated text, recordAttemptFailure NOT called
    expect(completeFn).toHaveBeenCalled();
    const callArgs = completeFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.enhancedContent).toBe('## Summary\nPlanning feedback');
    expect(recordFailure).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
