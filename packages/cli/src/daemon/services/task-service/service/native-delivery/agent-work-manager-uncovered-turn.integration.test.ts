/**
 * Uncovered-turn ladder — end-to-end over the real AgentWorkManager and the real TaskService.
 *
 * Only the agent process manager (a fake with a mutable slot), the backend, and the handoff
 * repository (in-memory) are replaced. Mocked harness, no LLM calls. Included in the default
 * `vitest run` suite.
 */

import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AssignedTaskWithContent } from '../../../../domain/entities/assigned-task.js';
import {
  AgentWorkManager,
  createAgentTaskStateService,
  type AgentStartedEvent,
} from '../../../agent-process-service/index.js';
import { computeBackoffDelay } from '../../domain/usecase/compute-backoff-delay.js';
import { createInMemoryTaskHandoffRepository } from '../../infrastructure/repository/task-handoff-repository.js';
import { createTaskService } from '../task-service.js';

const CHATROOM = 'room-1';
const ROLE = 'builder';
const MACHINE = 'machine-1';
const TASK_ID = 'task-1';
const CONFIG = { agentHarness: 'cursor-sdk', model: 'test-model', workingDir: '/test/workspace' };
const NUDGE_PREFIX = 'Your previous turn ended';

interface FakeSlot {
  readonly state: 'running';
  readonly pid: number;
  readonly harnessSessionId: string;
  readonly harness: string;
  readonly model: string;
  readonly workingDir: string;
  readonly nativeTurnPhase: 'idle';
}

function makeSlot(pid: number, harnessSessionId: string): FakeSlot {
  return {
    state: 'running',
    pid,
    harnessSessionId,
    harness: CONFIG.agentHarness,
    model: CONFIG.model,
    workingDir: CONFIG.workingDir,
    nativeTurnPhase: 'idle',
  };
}

function makeTask(): AssignedTaskWithContent {
  const now = 1_700_000_000_000;
  return {
    taskId: TASK_ID,
    chatroomId: CHATROOM,
    status: 'pending',
    assignedTo: ROLE,
    updatedAt: now,
    createdAt: now,
    agentConfig: { role: ROLE, machineId: MACHINE, ...CONFIG },
    taskContent: '## Goal\nDo the thing',
  } as unknown as AssignedTaskWithContent;
}

/** A fake agent process manager: one mutable running slot, recorded prompts, stop and start. */
function createFakeAgents(options: { startFailures?: number } = {}) {
  let pidSeq = 101;
  let sessionSeq = 1;
  let slot: FakeSlot | undefined = makeSlot(pidSeq, `sess-${sessionSeq}`);
  let startedListener: ((event: AgentStartedEvent) => Promise<unknown>) | undefined;
  const prompts: string[] = [];
  const stops: { reason: string; pid?: number | undefined }[] = [];
  const starts: { reason: string; wantResume: boolean }[] = [];

  const agentMgr = {
    getSlot: () => slot,
    isStopRequested: () => false,
    resumeTurnForSlot: (args: { prompt: string }) =>
      Effect.promise(async () => {
        prompts.push(args.prompt);
      }),
    subscribeAgentStarted: (listener: (event: AgentStartedEvent) => Promise<unknown>) => {
      startedListener = listener;
      return () => {
        startedListener = undefined;
      };
    },
    subscribeAgentTurnEnded: () => () => undefined,
    subscribeAgentSessionLost: () => () => undefined,
    subscribeAgentTurnProgress: () => () => undefined,
  };

  const runSerializedForAgent = async <T>(
    _key: unknown,
    _options: unknown,
    operation: (
      ops: {
        stopAgent: (input: { reason: string; pid?: number }) => Promise<{ success: boolean }>;
        startAgent: (input: {
          reason: string;
          wantResume: boolean;
        }) => Promise<{ success: boolean; pid?: number; error?: string }>;
      },
      context: { signal: AbortSignal }
    ) => Promise<T>
  ): Promise<T> =>
    operation(
      {
        stopAgent: async (input) => {
          stops.push({ reason: input.reason, pid: input.pid });
          slot = undefined;
          return { success: true };
        },
        startAgent: async (input) => {
          starts.push({ reason: input.reason, wantResume: input.wantResume });
          if (starts.length <= (options.startFailures ?? 0)) {
            return { success: false, error: 'rate_limited' };
          }
          pidSeq += 1;
          sessionSeq += 1;
          slot = makeSlot(pidSeq, `sess-${sessionSeq}`);
          // The real manager reports the start after the serialized section returns.
          setTimeout(() => {
            void startedListener?.({
              chatroomId: CHATROOM,
              role: ROLE,
              reason: input.reason as never,
            });
          }, 0);
          return { success: true, pid: pidSeq };
        },
      },
      { signal: new AbortController().signal }
    );

  return {
    agentMgr,
    runSerializedForAgent,
    prompts,
    stops,
    starts,
    current: () => slot,
    /** Simulates a session change without a stop/start (for example a harness-side rotation). */
    rotateSession: () => {
      sessionSeq += 1;
      slot = makeSlot(pidSeq, `sess-${sessionSeq}`);
    },
  };
}

function createDaemon(options: { agents?: ReturnType<typeof createFakeAgents> } = {}) {
  const agents = options.agents ?? createFakeAgents();
  const task = makeTask();
  const mutations: Record<string, unknown>[] = [];
  const backend = {
    mutation: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return {
        cleared: true,
        recorded: true,
        processed: true,
        marked: true,
        released: true,
        status: 'pending',
        updatedAt: Date.now(),
      };
    }),
    query: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      if ('machineId' in args && 'taskId' in args && !('chatroomId' in args)) return task;
      if ('chatroomId' in args && 'taskId' in args) return { fullCliOutput: 'DELIVERY OUTPUT' };
      return [];
    }),
  };
  const handoffRepository = createInMemoryTaskHandoffRepository();
  const taskService = createTaskService({
    sessionId: 'session-1',
    machineId: MACHINE,
    convexUrl: 'http://test:3210',
    configurationService: { get: () => CONFIG } as never,
    handoffRepository,
    backend: { mutation: backend.mutation as never, query: backend.query as never },
  } as never);
  // Seed the inbox the way the TaskService's own inbox does; its reader type is read-only.
  (taskService.taskInboxState as unknown as { upsert(tasks: unknown[]): void }).upsert([task]);

  const manager = new AgentWorkManager({
    configurationService: { get: () => CONFIG } as never,
    agentMgr: agents.agentMgr as never,
    runSerializedForAgent: agents.runSerializedForAgent as never,
    acquireNativeDeliverySlot: async () => {
      const current = agents.current();
      return current?.state === 'running' ? current : null;
    },
    sessionDeps: {
      sessionId: 'session-1',
      convexUrl: 'http://test:3210',
      machineId: MACHINE,
      backend,
    } as never,
    machineId: MACHINE,
    taskInboxState: taskService.taskInboxState,
    agentTaskState: createAgentTaskStateService(),
    lifecycleOutbox: { enqueue: async () => undefined },
    taskService,
  });

  const releaseSpy = vi.spyOn(taskService, 'releaseTaskAfterTurnFailure');

  const turnEnded = (
    status: 'completed' | 'failed',
    turnId: string,
    error = 'rate limit exceeded'
  ) => {
    const current = agents.current();
    if (!current) throw new Error('no running slot to end a turn on');
    return manager.handleAgentTurnEnded({
      chatroomId: CHATROOM,
      role: ROLE,
      pid: current.pid,
      harness: CONFIG.agentHarness,
      slot: {
        state: 'running',
        harnessSessionId: current.harnessSessionId,
        nativeTurnPhase: 'turn_in_flight',
      },
      eventId: turnId,
      completion:
        status === 'completed'
          ? { turnId, status, source: 'provider.result' }
          : { turnId, status, source: 'provider.transport', error },
    } as never);
  };

  return {
    manager,
    taskService,
    handoffRepository,
    agents,
    releaseSpy,
    turnEnded,
    /** Delivers the pending task, as an agent start would. */
    start: () => manager.handleAgentStarted({ chatroomId: CHATROOM, role: ROLE } as never),
    injections: () => agents.prompts.filter((p) => !p.startsWith(NUDGE_PREFIX)),
    nudges: () => agents.prompts.filter((p) => p.startsWith(NUDGE_PREFIX)),
    exhaustedWrites: () => mutations.filter((m) => m.reason === 'redelivery_exhausted'),
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 30)),
    dispose: () => manager.dispose(),
  };
}

describe('uncovered-turn ladder, end to end', () => {
  test('(a) an unanswered session is nudged, restarted into a new session, nudged again, then parked', async () => {
    const d = createDaemon();
    await d.start();
    await vi.waitFor(() => expect(d.injections()).toHaveLength(1));

    await d.turnEnded('completed', 'turn-1');
    await vi.waitFor(() => expect(d.nudges()).toHaveLength(1));
    expect(d.releaseSpy).not.toHaveBeenCalled();

    await d.turnEnded('completed', 'turn-2');
    await vi.waitFor(() => expect(d.agents.starts).toHaveLength(1));
    await vi.waitFor(() => expect(d.injections()).toHaveLength(2));
    expect(d.agents.stops).toEqual([{ reason: 'daemon.respawn', pid: 101 }]);
    expect(d.agents.starts).toEqual([{ reason: 'daemon.respawn', wantResume: false }]);

    await d.turnEnded('completed', 'turn-3');
    await vi.waitFor(() => expect(d.nudges()).toHaveLength(2));

    await d.turnEnded('completed', 'turn-4');
    await vi.waitFor(() => expect(d.exhaustedWrites()).toHaveLength(1));
    const injectionsAtPark = d.injections().length;
    await d.flush();
    expect(d.injections()).toHaveLength(injectionsAtPark);
    expect(d.nudges()).toHaveLength(2);
    expect(d.agents.starts).toHaveLength(1);
    expect(d.releaseSpy).not.toHaveBeenCalled();
    d.dispose();
  });

  test('(b) a covering handoff resets the ladder, so the next uncovered end is a nudge, not a restart', async () => {
    const d = createDaemon();
    await d.start();
    await vi.waitFor(() => expect(d.injections()).toHaveLength(1));

    await d.turnEnded('completed', 'turn-1');
    await vi.waitFor(() => expect(d.nudges()).toHaveLength(1));

    await d.handoffRepository.record({
      chatroomId: CHATROOM,
      role: ROLE,
      taskIds: [TASK_ID],
      targetRole: 'reviewer',
      handedOffAt: Date.now(),
    });
    await d.turnEnded('completed', 'turn-2');
    await d.flush();

    // Same session: without the reset this end would restart the session.
    await d.handoffRepository.record({
      chatroomId: CHATROOM,
      role: ROLE,
      taskIds: ['other-task'],
      targetRole: 'reviewer',
      handedOffAt: Date.now(),
    });
    await d.turnEnded('completed', 'turn-3');
    await vi.waitFor(() => expect(d.nudges()).toHaveLength(2));
    expect(d.agents.starts).toHaveLength(0);
    d.dispose();
  });

  test('(c) eight failed turns park at the raised failure cap, with no nudge and no restart', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const d = createDaemon();
      await d.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(d.injections()).toHaveLength(1);

      // The cap is 8 provider failures; each release waits the attempt's backoff
      // before the task becomes pending again and is redelivered.
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        await d.turnEnded('failed', `fail-${attempt}`);
        if (attempt < 8) {
          expect(d.exhaustedWrites()).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(computeBackoffDelay(attempt, () => 0.5));
          await vi.advanceTimersByTimeAsync(0);
          // A start redelivers the now-pending task (as the next daemon pass would).
          await d.start();
          await vi.advanceTimersByTimeAsync(0);
          expect(d.injections()).toHaveLength(attempt + 1);
        }
      }

      expect(d.exhaustedWrites()).toHaveLength(1);
      expect(d.nudges()).toHaveLength(0);
      expect(d.agents.starts).toHaveLength(0);
      d.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('(c) after one nudge, failed turns do not reset the nudge budget: the next uncovered end restarts', async () => {
    const d = createDaemon();
    await d.start();
    await vi.waitFor(() => expect(d.injections()).toHaveLength(1));

    await d.turnEnded('completed', 'turn-1');
    await vi.waitFor(() => expect(d.nudges()).toHaveLength(1));

    await d.turnEnded('failed', 'fail-1');
    await d.start();
    await vi.waitFor(() => expect(d.injections()).toHaveLength(2));

    await d.turnEnded('completed', 'turn-2');
    await vi.waitFor(() => expect(d.agents.starts).toHaveLength(1));
    expect(d.nudges()).toHaveLength(1);
    d.dispose();
  });

  test('(d) a new daemon instance rebuilds the ladder from empty: the first uncovered end is a nudge', async () => {
    const first = createDaemon();
    await first.start();
    await vi.waitFor(() => expect(first.injections()).toHaveLength(1));
    await first.turnEnded('completed', 'turn-1');
    await vi.waitFor(() => expect(first.nudges()).toHaveLength(1));
    first.dispose();

    // Simulated daemon restart: same agent process and session, fresh services.
    const second = createDaemon({ agents: first.agents });
    await second.start();
    await vi.waitFor(() => expect(second.injections()).toHaveLength(2));
    await second.turnEnded('completed', 'turn-2');
    await vi.waitFor(() => expect(second.nudges()).toHaveLength(2));
    expect(second.agents.starts).toHaveLength(0);
    second.dispose();
  });

  describe('respawn start retries', () => {
    /** Gets a daemon to the point where its first restart has been requested and its start has failed. */
    async function restartWithFailingStart(startFailures: number) {
      const agents = createFakeAgents({ startFailures });
      const d = createDaemon({ agents });
      await d.start();
      await vi.waitFor(() => expect(d.injections()).toHaveLength(1));
      await d.turnEnded('completed', 'turn-1');
      await vi.waitFor(() => expect(d.nudges()).toHaveLength(1));
      // Let the nudge's send resolve and commit to the ladder before the next turn ends.
      await vi.advanceTimersByTimeAsync(100);
      await d.turnEnded('completed', 'turn-2');
      await vi.waitFor(() => expect(agents.starts).toHaveLength(1));
      return { agents, d };
    }

    test('a start that fails twice is retried, and the third start delivers into the new session', async () => {
      vi.useFakeTimers();
      try {
        const { agents, d } = await restartWithFailingStart(2);
        const decide = vi.spyOn(d.taskService, 'decideUncoveredTurnEnd');

        await vi.advanceTimersByTimeAsync(1_000);
        expect(agents.starts).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(2_000);
        await vi.waitFor(() => expect(d.injections()).toHaveLength(2));

        expect(agents.starts).toHaveLength(3);
        expect(agents.starts.at(-1)).toEqual({ reason: 'daemon.respawn', wantResume: false });
        // The ladder ran only for the two uncovered ends; retries never re-enter it.
        expect(decide).toHaveBeenCalledTimes(0);
        d.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    test('a start that keeps failing retries indefinitely for native harnesses', async () => {
      vi.useFakeTimers();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { agents, d } = await restartWithFailingStart(100);

        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(2_000);
        await vi.advanceTimersByTimeAsync(60_000);

        // Native harnesses no longer stop after three starts and never log exhaustion.
        expect(agents.starts.length).toBeGreaterThan(3);
        expect(errors.mock.calls.join('\n')).not.toContain('attempts exhausted');

        // The interval is capped, but retries continue past the old 30s bound.
        await vi.advanceTimersByTimeAsync(600_000 * 2);
        expect(agents.starts.length).toBeGreaterThan(7);
        expect(errors.mock.calls.join('\n')).not.toContain('attempts exhausted');
        expect(d.taskService.taskInboxState.getForRole(CHATROOM, ROLE, TASK_ID)?.status).toBe(
          'pending'
        );
        expect(d.injections()).toHaveLength(1);
        d.dispose();
      } finally {
        errors.mockRestore();
        vi.useRealTimers();
      }
    });

    test('a user-initiated start during the retry window stops the retries', async () => {
      vi.useFakeTimers();
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const { agents, d } = await restartWithFailingStart(99);

        await d.manager.handleAgentStarted({
          chatroomId: CHATROOM,
          role: ROLE,
          reason: 'user.start',
        } as never);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(agents.starts).toHaveLength(1);
        expect(logs).toHaveBeenCalledWith(
          expect.stringContaining('[NativeDelivery:uncovered-restart-cancelled]')
        );
        expect(logs).toHaveBeenCalledWith(
          expect.stringContaining('reason=agent_started:user.start')
        );
        d.dispose();
      } finally {
        logs.mockRestore();
        vi.useRealTimers();
      }
    });

    test('no retry is scheduled after dispose', async () => {
      vi.useFakeTimers();
      try {
        const { agents, d } = await restartWithFailingStart(99);

        d.dispose();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(agents.starts).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
