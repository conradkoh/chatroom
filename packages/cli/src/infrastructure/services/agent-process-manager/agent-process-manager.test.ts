import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_TRIGGER_PROMPT } from '../remote-agents/spawn-prompt.js';

import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
  type EnsureRunningOpts,
} from './agent-process-manager.js';
import {
  CRASH_LOOP_MAX_RESTARTS,
  CrashLoopTracker,
} from '../../machine/crash-loop-tracker.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'test-chatroom';
const ROLE = 'builder';
const PID = 42;

function createMockService() {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    isInstalled: vi.fn().mockReturnValue(true),
    getVersion: vi.fn().mockReturnValue({ version: '1.0.0', major: 1 }),
    listModels: vi.fn().mockResolvedValue([]),
    spawn: vi.fn().mockResolvedValue({
      pid: PID,
      onExit: vi.fn(),
      onOutput: vi.fn(),
      onAgentEnd: vi.fn(),
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockReturnValue(false),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  };
}

function createDeps(overrides?: Partial<AgentProcessManagerDeps>): AgentProcessManagerDeps {
  const mockService = createMockService();
  return {
    agentServices: new Map([['opencode', mockService]]),
    backend: {
      query: vi.fn().mockResolvedValue({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: 'Start working',
      }),
      mutation: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'test-session',
    machineId: 'test-machine',
    processes: { kill: vi.fn() },
    clock: {
      delay: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValue(Date.now()),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    persistence: {
      persistAgentPid: vi.fn(),
      clearAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue([]),
    },
    spawning: {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
    },
    crashLoop: new CrashLoopTracker(),
    convexUrl: 'http://test:3210',
    ...overrides,
  };
}

function createOpts(overrides?: Partial<EnsureRunningOpts>): EnsureRunningOpts {
  return {
    chatroomId: CHATROOM_ID,
    role: ROLE,
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AgentProcessManager', () => {
  let deps: AgentProcessManagerDeps;
  let manager: AgentProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    manager = new AgentProcessManager(deps);
  });

  // ── ensureRunning ─────────────────────────────────────────────────────

  describe('ensureRunning', () => {
    test('idle → spawning → running: spawns process and transitions correctly', async () => {
      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeDefined();
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(PID);
      expect(slot!.harness).toBe('opencode');
      expect(slot!.model).toBe('gpt-4');
      expect(slot!.workingDir).toBe('/tmp/test');

      // Verify backend interactions
      const service = deps.agentServices.get('opencode')!;
      expect(service.spawn).toHaveBeenCalledOnce();
      expect(deps.spawning.recordSpawn).toHaveBeenCalledWith(CHATROOM_ID);
      expect(deps.persistence.persistAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE,
        PID,
        'opencode'
      );
    });

    test('substitutes DEFAULT_TRIGGER_PROMPT when backend returns empty initialMessage', async () => {
      // Use case-level regression guard: composeInitMessage in the backend currently
      // returns '' for every role. The manager must wrap that via createSpawnPrompt
      // before calling service.spawn so harnesses never receive an empty user message.
      // Without this, the opencode-sdk harness sends parts:[{text:''}] which
      // some providers (e.g. MiniMax) reject with `messages must not be empty`.
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: '',
      });

      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      expect(service.spawn).toHaveBeenCalledOnce();
      const spawnArgs = (service.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnArgs.prompt).toBe(DEFAULT_TRIGGER_PROMPT);
      expect(spawnArgs.systemPrompt).toBe('You are a builder');
    });

    test('already running: returns immediately with existing PID', async () => {
      // First call: spawn
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Second call: should return immediately
      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });
      expect(service.spawn).not.toHaveBeenCalled();
    });

    test('concurrent calls: second call awaits the first, does not spawn twice', async () => {
      let resolveSpawn: (value: any) => void;
      const spawnPromise = new Promise((resolve) => {
        resolveSpawn = resolve;
      });

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        await spawnPromise;
        return {
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        };
      });

      // Fire both concurrently
      const p1 = manager.ensureRunning(createOpts());
      const p2 = manager.ensureRunning(createOpts());

      // Resolve the spawn
      resolveSpawn!(undefined);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ success: true, pid: PID });
      expect(r2).toEqual({ success: true, pid: PID });
      expect(service.spawn).toHaveBeenCalledTimes(1);
    });

    test('rate limited: returns failure, slot stays idle', async () => {
      (deps.spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>).mockReturnValue({
        allowed: false,
      });

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: false, error: 'rate_limited' });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
    });

    test('crash loop: returns failure, emits restartLimitReached', async () => {
      // Fill the window to max successful restarts: spacing must satisfy backoff (30s then 60s)
      // and keep all timestamps within CRASH_LOOP_WINDOW_MS so the limit check applies.
      const base = 1_700_000_000_000;
      const now = vi.mocked(deps.clock.now);
      now.mockReturnValue(base);
      deps.crashLoop.record(CHATROOM_ID, ROLE, base);
      let t = base + 30_000;
      for (let i = 1; i < CRASH_LOOP_MAX_RESTARTS; i++) {
        now.mockReturnValue(t);
        deps.crashLoop.record(CHATROOM_ID, ROLE, t);
        t += 60_000;
      }
      now.mockReturnValue(t);

      const result = await manager.ensureRunning(
        createOpts({ reason: 'platform.crash_recovery' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('crash_loop');

      // Should have emitted event
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: ROLE,
          restartCount: expect.any(Number),
          windowMs: expect.any(Number),
        })
      );

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
    });

    test('spawn fails: returns failure, slot transitions back to idle', async () => {
      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('spawn error'));

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: false, error: 'Failed to spawn agent: spawn error' });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
    });

    test('invalid working dir: returns failure', async () => {
      (deps.fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        isDirectory: () => false,
      });

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    test('working dir does not exist: returns failure', async () => {
      (deps.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    test('unknown harness: returns failure', async () => {
      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor' }) // Use valid type but no service registered
      );
      // Remove the cursor service so it's "unknown"
      deps.agentServices.delete('cursor');

      const result2 = await manager.ensureRunning({
        ...createOpts(),
        agentHarness: 'cursor', // valid type, but no service for it
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('Unknown agent harness');
    });

    test('init prompt fetch fails: returns failure', async () => {
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network error')
      );

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch init prompt');
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────

  describe('stop', () => {
    test('running → stopping → idle: kills process, emits exit event, clears disk', async () => {
      // Start agent first
      await manager.ensureRunning(createOpts());

      // Mock process.kill to pretend process dies on signal 0 check
      let killed = false;
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(
        (pid: number, sig: string | number) => {
          if (sig === 0 && killed) throw new Error('ESRCH');
          if (sig === 'SIGTERM') killed = true;
        }
      );

      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
      expect(slot!.pid).toBeUndefined();

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
    });

    test('already idle: returns success and notifies backend for cleanup', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });

      // Verify that recordAgentExited was called for idle cleanup
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(), // api.machines.recordAgentExited
        expect.objectContaining({
          sessionId: 'test-session',
          machineId: 'test-machine',
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: 0,
          stopReason: 'user.stop',
        })
      );
    });

    test('already idle with event PID: attempts to kill the process and reports exit with that PID', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
        pid: 12345,
      });

      expect(result).toEqual({ success: true });

      // Should attempt to kill the event PID
      expect(deps.processes.kill).toHaveBeenCalledWith(12345, 'SIGTERM');

      // Should report exit with the event PID, not 0
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pid: 12345,
          stopReason: 'user.stop',
        })
      );
    });

    test('already idle without event PID: reports exit with pid 0 (backward compat)', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });

      // Should report exit with pid 0 (no PID available)
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pid: 0,
          stopReason: 'user.stop',
        })
      );
    });

    test('concurrent stop calls: second awaits first', async () => {
      await manager.ensureRunning(createOpts());

      // Make the process die on first SIGTERM check
      let killed = false;
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(
        (pid: number, sig: string | number) => {
          if (sig === 0 && killed) throw new Error('ESRCH');
          if (sig === 'SIGTERM') killed = true;
        }
      );

      const p1 = manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });
      const p2 = manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ success: true });
      expect(r2).toEqual({ success: true });
    });

    test('stop + onExit callback does NOT produce duplicate exit events', async () => {
      // This tests the fix for the double agent.exited bug:
      // When stop() kills a process, the onExit callback also fires.
      // Only ONE recordAgentExited call should be made (from doStop), not two.
      await manager.ensureRunning(createOpts());

      // Capture the onExit callback registered during spawn
      const service = deps.agentServices.get('opencode')!;
      const spawnMockResult = (service.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
      const resolvedSpawn = await spawnMockResult;
      const registeredOnExit = (resolvedSpawn.onExit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

      // Reset the backend mutation mock to track calls from here
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      // Mock process.kill: process dies on SIGTERM, then signal 0 throws
      let killed = false;
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(
        (pid: number, sig: string | number) => {
          if (sig === 0 && killed) throw new Error('ESRCH');
          if (sig === 'SIGTERM') {
            killed = true;
            // Simulate: the onExit callback fires when the process dies
            // This happens asynchronously in real life, but we call it here
            // to simulate the race condition
            if (registeredOnExit) {
              registeredOnExit({ code: null, signal: 'SIGTERM' });
            }
          }
        }
      );

      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      // Count all backend.mutation calls — should be exactly 1 (from doStop only)
      // Before the fix, handleExit would also fire, producing 2 calls
      const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      expect(mutationCalls).toHaveLength(1);
    });
  });

  // ── handleExit ────────────────────────────────────────────────────────

  describe('handleExit', () => {
    test('unexpected exit triggers auto restart', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;

      // Reset spawn mock for the restart call
      (service.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 100,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });

      // Simulate process exit directly via handleExit
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Allow async restart to run
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(2); // original + restart
      });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(100);
    });

    test('signal exit (SIGTERM) triggers restart (no stale reason leak)', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // SIGTERM exit → agent_process.signal → should trigger restart
      // This verifies no stale state from prior stops leaks into the reason
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: 'SIGTERM',
      });

      // Should restart because agent_process.signal is a restartable reason
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(1);
      });
    });

    test('stale PID is ignored', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Simulate exit with WRONG PID — should be ignored
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 99999, // Different from PID (42)
        code: 1,
        signal: null,
      });

      // Slot should remain running
      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(PID);
      expect(service.spawn).not.toHaveBeenCalled();
    });

    test('exit without harness/workingDir does not restart', async () => {
      // Manually set a slot without workingDir
      await manager.ensureRunning(createOpts());

      // Hack: remove workingDir from slot to simulate edge case
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.workingDir = undefined;

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Should NOT restart since workingDir is missing
      // Wait a tick for any async work
      await new Promise((r) => setTimeout(r, 10));
      expect(service.spawn).not.toHaveBeenCalled();
    });

    test('crash after previous stop does not leak stale stop reason', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;

      // Stop the agent intentionally (user.stop)
      await manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });

      // Restart the agent
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();
      (service.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 200,
        workingDir: '/test/work',
      });
      await manager.ensureRunning(createOpts());

      // Clear mutation mock to isolate the exit event we care about
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      // Now let it crash — the stop reason should be derived from exit info,
      // NOT leaked from the previous user.stop
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 200,
        code: 1,
        signal: null,
      });

      // Verify the recordAgentExited mutation was called with agent_process.crashed
      await vi.waitFor(() => {
        const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
        const exitCall = mutationCalls.find(
          (c: unknown[]) =>
            c[1] &&
            typeof c[1] === 'object' &&
            (c[1] as Record<string, unknown>).stopReason !== undefined
        );
        expect(exitCall).toBeDefined();
        expect((exitCall![1] as Record<string, unknown>).stopReason).toBe(
          'agent_process.crashed'
        );
      });
    });

    test('clean exit triggers restart', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Clean exit with code 0 → agent_process.exited_clean → triggers restart
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });

      // Should restart (exited_clean is not intentional)
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ── recover ───────────────────────────────────────────────────────────

  describe('recover', () => {
    test('alive PIDs are restored to running state', async () => {
      (deps.persistence.listAgentEntries as ReturnType<typeof vi.fn>).mockReturnValue([
        { chatroomId: CHATROOM_ID, role: ROLE, entry: { pid: 1234, harness: 'opencode' } },
      ]);

      // process.kill(pid, 0) succeeds → alive
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {});

      await manager.recover();

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeDefined();
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(1234);
      expect(slot!.harness).toBe('opencode');
    });

    test('dead PIDs are cleaned up', async () => {
      (deps.persistence.listAgentEntries as ReturnType<typeof vi.fn>).mockReturnValue([
        { chatroomId: CHATROOM_ID, role: ROLE, entry: { pid: 9999, harness: 'opencode' } },
      ]);

      // process.kill(pid, 0) throws → dead
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ESRCH');
      });

      await manager.recover();

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeUndefined(); // No slot created for dead process

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
    });
  });

  // ── listActive ────────────────────────────────────────────────────────

  describe('listActive', () => {
    test('returns running and spawning slots', async () => {
      await manager.ensureRunning(createOpts());
      await manager.ensureRunning(createOpts({ chatroomId: 'other-room', role: 'reviewer' }));

      const active = manager.listActive();
      expect(active).toHaveLength(2);
      expect(active.map((a) => a.role)).toContain('builder');
      expect(active.map((a) => a.role)).toContain('reviewer');
    });

    test('does not include idle slots', async () => {
      // Create and then exit an agent
      await manager.ensureRunning(createOpts());
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Wait for the restart attempt to complete (or fail due to spawning)
      await new Promise((r) => setTimeout(r, 50));

      // The slot might be running again due to auto-restart. Let's check differently:
      // Just verify listActive works
      const active = manager.listActive();
      for (const entry of active) {
        expect(['running', 'spawning']).toContain(entry.slot.state);
      }
    });
  });

  // ── exitRetryQueue ────────────────────────────────────────────────────

  describe('exitRetryQueue', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('queues exit event for retry when recordAgentExited fails in handleExit', async () => {
      // Arrange: mutation mock — all calls succeed by default, except for recordAgentExited on first try
      const mutation = vi.fn().mockResolvedValue(undefined);
      // Allow first spawn, then block restarts
      const shouldAllowSpawn = vi.fn()
        .mockReturnValueOnce({ allowed: true })      // first spawn succeeds
        .mockReturnValue({ allowed: false, retryAfterMs: 60_000 }); // no restarts

      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
        spawning: {
          shouldAllowSpawn,
          recordSpawn: vi.fn(),
          recordExit: vi.fn(),
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn agent
      const result = await localManager.ensureRunning(createOpts());
      expect(result.success).toBe(true);

      // recordAgentExited fails on the next call
      mutation.mockRejectedValueOnce(new Error('fetch failed'));

      const callsBeforeExit = mutation.mock.calls.length;

      // Trigger exit
      localManager.handleExit({ chatroomId: CHATROOM_ID, role: ROLE, pid: PID, code: 0, signal: null });

      // Let the promise rejection propagate
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // recordAgentExited was attempted (and failed)
      expect(mutation.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeExit + 1);

      // Advance timers to trigger retry — retry should succeed now (mock returns resolved)
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Verify a retry was attempted (at least one more mutation call)
      expect(mutation.mock.calls.length).toBeGreaterThan(callsBeforeExit + 1);
    });

    test('removes item from retry queue on successful retry', async () => {
      const mutation = vi.fn();
      // First: spawn-related mutations succeed
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // recordAgentExited fails first time
      mutation.mockRejectedValueOnce(new Error('fetch failed'));

      localManager.handleExit({ chatroomId: CHATROOM_ID, role: ROLE, pid: PID, code: 0, signal: null });
      await Promise.resolve();
      await Promise.resolve();

      // Now retry succeeds
      mutation.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // After success, the timer should stop (advancing again won't trigger more mutations)
      const callCountAfterSuccess = mutation.mock.calls.length;
      mutation.mockResolvedValueOnce(undefined); // would be called if timer still running
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();

      // No additional calls — timer was stopped
      expect(mutation.mock.calls.length).toBe(callCountAfterSuccess);
    });

    test('keeps item in retry queue when retry also fails', async () => {
      const mutation = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // Initial recordAgentExited fails
      mutation.mockRejectedValueOnce(new Error('fetch failed'));
      localManager.handleExit({ chatroomId: CHATROOM_ID, role: ROLE, pid: PID, code: 0, signal: null });
      await Promise.resolve();
      await Promise.resolve();

      const callsAfterFirstFail = mutation.mock.calls.length;

      // Retry also fails
      mutation.mockRejectedValueOnce(new Error('still offline'));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // A retry was attempted (mutation called again)
      expect(mutation.mock.calls.length).toBeGreaterThan(callsAfterFirstFail);

      // Retry second time succeeds
      mutation.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Timer should stop now
      const callCountAfterSecondSuccess = mutation.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      expect(mutation.mock.calls.length).toBe(callCountAfterSecondSuccess);
    });

    test('queues multiple failed exit events independently', async () => {
      const mutation = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn two agents
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-1', role: 'builder' }));
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-2', role: 'builder' }));

      // Both recordAgentExited calls fail
      mutation.mockRejectedValueOnce(new Error('offline'));
      mutation.mockRejectedValueOnce(new Error('offline'));

      localManager.handleExit({ chatroomId: 'room-1', role: 'builder', pid: PID, code: 0, signal: null });
      localManager.handleExit({ chatroomId: 'room-2', role: 'builder', pid: PID, code: 0, signal: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const callsBeforeRetry = mutation.mock.calls.length;

      // Both retries succeed
      mutation.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // 2 additional retry calls were made
      expect(mutation.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 2);
    });
  });
});
