import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { startEnhancerJobSubscriber } from './job-subscriber.js';
import {
  getEnhancerQueuePort,
  setEnhancerQueueDb,
} from '../../infrastructure/persistence/enhancer-queue.js';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';

vi.mock('../../../api.js', () => {
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
  setPath(api, ['web', 'enhancer', 'index', 'getJobOutcome'], 'getJobOutcome');
  setPath(api, ['daemon', 'enhancer', 'index', 'pendingForMachine'], 'pendingForMachine');
  setPath(api, ['participants', 'join'], 'participantsJoin');
  setPath(api, ['participants', 'updateTokenActivity'], 'updateTokenActivity');
  return { api };
});

function createWsClient() {
  let outcomeCallback: ((state: unknown) => void) | undefined;
  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      outcomeCallback = onUpdate;
      onUpdate({ status: 'running', attemptCount: 1, maxAttempts: 3 });
      return vi.fn();
    }),
  };
  return {
    wsClient,
    emitOutcome: (state: unknown) => outcomeCallback?.(state),
  };
}

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
      if (endpoint === 'pendingForMachine') {
        return [{ jobId: 'job1', chatroomId: 'room1' }];
      }
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
    const { wsClient } = createWsClient();

    const handles = startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      wsClient as any,
      backend as any,
      agentServices as any
    );

    await handles.drainPendingEnhancerJobs();

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
      if (endpoint === 'pendingForMachine') {
        return [{ jobId: 'job1', chatroomId: 'room1' }];
      }
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
    const { wsClient } = createWsClient();

    const handles = startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      wsClient as any,
      backend as any,
      agentServices as any
    );

    await handles.drainPendingEnhancerJobs();

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

    const { wsClient, emitOutcome } = createWsClient();
    const completeFn = vi.fn().mockImplementation(async () => {
      emitOutcome({ status: 'complete', attemptCount: 1, maxAttempts: 3 });
    });
    const recordFailure = vi.fn();
    const mutationFn = vi.fn().mockImplementation((endpoint: string, args: unknown) => {
      if (endpoint === 'claimForSpawn') return { claimed: true };
      if (endpoint === 'complete') return completeFn(args);
      if (endpoint === 'recordAttemptFailure') return recordFailure(args);
      return undefined;
    });
    const queryFn = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === 'pendingForMachine') {
        return [{ jobId: 'job1', chatroomId: 'room1' }];
      }
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
      return Promise.resolve(null);
    });

    const backend = {
      mutation: mutationFn,
      query: queryFn,
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

    const handles = startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      wsClient as any,
      backend as any,
      agentServices as any
    );

    await handles.drainPendingEnhancerJobs();
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

  it('does not call participants.join or updateTokenActivity (enhancer is a worker, not a team agent)', async () => {
    vi.useFakeTimers();

    let outputCallback: (() => void) | undefined;
    const updateTokenActivity = vi.fn().mockResolvedValue(undefined);
    const participantsJoin = vi.fn().mockResolvedValue(undefined);
    const mutationFn = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === 'claimForSpawn') return { claimed: true };
      if (endpoint === 'participantsJoin') return participantsJoin();
      if (endpoint === 'updateTokenActivity') return updateTokenActivity();
      return undefined;
    });
    const queryFn = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === 'pendingForMachine') {
        return [{ jobId: 'job1', chatroomId: 'room1' }];
      }
      if (endpoint === 'getSpawnPayload') {
        return {
          chatroomId: 'room1',
          jobId: 'job1',
          agentHarness: 'opencode-sdk',
          model: 'm',
          workingDir: '/tmp',
          systemPrompt: 'sys',
          taskEnvelope: 'task',
        };
      }
      return Promise.resolve({ status: 'running' });
    });

    const backend = { mutation: mutationFn, query: queryFn };

    const spawn = vi.fn().mockReturnValue({
      onExit: vi.fn(),
      onOutput: (fn: () => void) => {
        outputCallback = fn;
      },
      onLogLine: vi.fn(),
      onAssistantText: vi.fn(),
      pid: 123,
    });
    const agentServices = new Map([['opencode-sdk', { spawn, stop: vi.fn() }]]);
    const { wsClient } = createWsClient();

    const handles = startEnhancerJobSubscriber(
      'session',
      'machine',
      'http://localhost',
      wsClient as any,
      backend as any,
      agentServices as any
    );

    await handles.drainPendingEnhancerJobs();
    await vi.advanceTimersByTimeAsync(10);

    expect(participantsJoin).not.toHaveBeenCalled();
    expect(updateTokenActivity).not.toHaveBeenCalled();

    outputCallback?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(participantsJoin).not.toHaveBeenCalled();
    expect(updateTokenActivity).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('polls the local enhancer queue when P4 is enabled', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'p4-enhancer-subscriber-'));
    const db = openDatabase(join(dir, 'events.sqlite'));
    process.env.DAEMON_ORCHESTRATION_P4 = '1';
    try {
      setEnhancerQueueDb(db);
      const queue = getEnhancerQueuePort();
      queue.enqueue({
        jobId: 'local:room-1:msg-1',
        chatroomId: 'room-1',
        machineId: 'machine-1',
        payload: {
          agentHarness: 'opencode',
          model: 'gpt-4o',
          machineId: 'machine-1',
          content: 'review',
          workingDir: '/tmp/work',
        },
      });

      let exitCallback: (() => void) | undefined;
      const spawn = vi.fn().mockReturnValue({
        onLogLine: vi.fn(),
        onExit: (fn: () => void) => {
          exitCallback = fn;
        },
        onAgentEnd: vi.fn(),
        pid: 123,
      });
      const agentServices = new Map([
        ['opencode', { spawn, stop: vi.fn().mockResolvedValue(undefined) }],
      ]);
      const mutationFn = vi.fn();
      const queryFn = vi.fn().mockResolvedValue([]);
      const backend = { mutation: mutationFn, query: queryFn };

      const handles = startEnhancerJobSubscriber(
        'session',
        'machine-1',
        'http://localhost',
        backend as any,
        agentServices as any
      );

      await handles.drainPendingEnhancerJobs();
      await vi.advanceTimersByTimeAsync(10);

      // Local claim + spawn, no Convex pendingForMachine/claimForSpawn calls.
      expect(mutationFn).not.toHaveBeenCalled();
      expect(queryFn).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDir: '/tmp/work',
          model: 'gpt-4o',
          context: { machineId: 'machine-1', chatroomId: 'room-1', role: 'enhancer' },
        })
      );

      const row = db
        .prepare(`SELECT status FROM enhancer_queue WHERE job_id = ?`)
        .get('local:room-1:msg-1') as { status: string };
      expect(row.status).toBe('claimed');

      exitCallback!();
      await vi.runAllTimersAsync();

      const after = db
        .prepare(`SELECT status FROM enhancer_queue WHERE job_id = ?`)
        .get('local:room-1:msg-1') as { status: string };
      expect(after.status).toBe('failed');
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P4;
      setEnhancerQueueDb(undefined);
      db.close();
      vi.useRealTimers();
    }
  });
});
