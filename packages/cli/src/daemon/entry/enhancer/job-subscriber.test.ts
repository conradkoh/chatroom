import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function enqueueLocalEnhancerJob(machineId = 'machine') {
  getEnhancerQueuePort().enqueue({
    jobId: 'job1',
    chatroomId: 'room1',
    machineId,
    payload: {
      agentHarness: 'opencode',
      model: 'm',
      workingDir: '/tmp',
      content: 'task envelope',
      machineId,
    },
  });
}

function createEnhancerSpawnMock(
  handlers: {
    exitCallback?: () => void;
    agentEndCallback?: () => void;
  } = {}
) {
  return vi.fn().mockReturnValue({
    pid: 123,
    harnessSessionId: 'harness-1',
    onExit: (cb: () => void) => {
      handlers.exitCallback = cb;
    },
    onAgentEnd: (cb: () => void) => {
      handlers.agentEndCallback = cb;
    },
    onAssistantText: vi.fn(),
    onLogLine: vi.fn(),
  });
}

describe('startEnhancerJobSubscriber', () => {
  let testQueueDb: ReturnType<typeof openDatabase> | undefined;

  function queueJobStatus(jobId: string): string {
    const row = testQueueDb!
      .prepare(`SELECT status FROM enhancer_queue WHERE job_id = ?`)
      .get(jobId) as { status: string };
    return row.status;
  }
  beforeEach(() => {
    testQueueDb = openDatabase(
      join(mkdtempSync(join(tmpdir(), 'enhancer-test-')), 'events.sqlite')
    );
    setEnhancerQueueDb(testQueueDb);
  });
  afterEach(() => {
    setEnhancerQueueDb(undefined);
    testQueueDb?.close();
  });
  it('marks local queue job failed when harness exits without agent_end', async () => {
    vi.useFakeTimers();

    const mutationFn = vi.fn();
    const queryFn = vi.fn();
    const backend = { mutation: mutationFn, query: queryFn };

    const spawnHandlers: { exitCallback?: () => void } = {};
    const spawn = createEnhancerSpawnMock(spawnHandlers);
    const agentServices = new Map([
      ['opencode', { spawn, stop: vi.fn().mockResolvedValue(undefined) }],
    ]);
    const { wsClient } = createWsClient();

    enqueueLocalEnhancerJob();

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

    expect(spawn).toHaveBeenCalled();
    expect(queueJobStatus('job1')).toBe('claimed');

    spawnHandlers.exitCallback!();
    await vi.runAllTimersAsync();

    expect(queueJobStatus('job1')).toBe('failed');
    expect(mutationFn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('marks local queue job complete on agent_end', async () => {
    vi.useFakeTimers();

    const mutationFn = vi.fn();
    const queryFn = vi.fn();
    const backend = { mutation: mutationFn, query: queryFn };

    const spawnHandlers: { agentEndCallback?: () => void } = {};
    const spawn = createEnhancerSpawnMock(spawnHandlers);
    const agentServices = new Map([
      ['opencode', { spawn, stop: vi.fn().mockResolvedValue(undefined) }],
    ]);
    const { wsClient } = createWsClient();

    enqueueLocalEnhancerJob();

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

    spawnHandlers.agentEndCallback!();
    await vi.runAllTimersAsync();

    expect(queueJobStatus('job1')).toBe('complete');
    expect(mutationFn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('marks local queue job complete on agent_end without Convex salvage', async () => {
    vi.useFakeTimers();

    const { wsClient } = createWsClient();
    const completeFn = vi.fn();
    const mutationFn = vi.fn().mockImplementation((endpoint: string, args: unknown) => {
      if (endpoint === 'complete') return completeFn(args);
      return undefined;
    });
    const backend = { mutation: mutationFn, query: vi.fn() };

    const spawnHandlers: { agentEndCallback?: () => void } = {};
    const spawn = createEnhancerSpawnMock(spawnHandlers);
    const agentServices = new Map([
      ['opencode', { spawn, stop: vi.fn().mockResolvedValue(undefined) }],
    ]);

    enqueueLocalEnhancerJob();

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

    spawnHandlers.agentEndCallback!();
    await vi.runAllTimersAsync();

    expect(queueJobStatus('job1')).toBe('complete');
    expect(completeFn).not.toHaveBeenCalled();

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
    process.env.UNCONDITIONAL_CUTOVER = '1';
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
      const wsClient = {} as any;

      const handles = startEnhancerJobSubscriber(
        'session',
        'machine-1',
        'http://localhost',
        wsClient,
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
      delete process.env.UNCONDITIONAL_CUTOVER;
      setEnhancerQueueDb(undefined);
      db.close();
      vi.useRealTimers();
    }
  });
});
