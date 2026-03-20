import { describe, expect, test, vi, beforeEach } from 'vitest';

import { SpawnGateService } from './spawn-gate-service.js';
import type { SpawnRequest } from './spawn-gate-service.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import type { Id } from '../../../api.js';
import { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';

// ─── Mock executeStartAgent ─────────────────────────────────────────────────

const mockExecuteStartAgent = vi.fn();

vi.mock('../../../commands/machine/daemon-start/handlers/start-agent.js', () => ({
  executeStartAgent: (...args: unknown[]) => mockExecuteStartAgent(...args),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'test-chatroom' as Id<'chatroom_rooms'>;

function createMockContext(): DaemonContext {
  return {
    client: {},
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } as any,
    agentServices: new Map(),
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: { kill: vi.fn() },
      fs: { stat: vi.fn() },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockReturnValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockReturnValue(null),
      },
      clock: { now: () => Date.now(), delay: vi.fn().mockResolvedValue(undefined) },
      spawning: {
        shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
        recordSpawn: vi.fn(),
        recordExit: vi.fn(),
        getConcurrentCount: vi.fn().mockReturnValue(0),
      },
      spawnGate: null as any, // Will be set by the test
    },
    activeWorkingDirs: new Set(),
    lastPushedGitState: new Map(),
    pendingStops: new Map(),
    spawnLocks: new Map(),
  };
}

function createRequest(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    chatroomId: CHATROOM_ID,
    role: 'builder',
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SpawnGateService', () => {
  let spawning: ReturnType<typeof createMockContext>['deps']['spawning'];
  let crashLoop: CrashLoopTracker;
  let gate: SpawnGateService;
  let ctx: DaemonContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
    spawning = ctx.deps.spawning;
    crashLoop = new CrashLoopTracker();
    gate = new SpawnGateService({ spawning, crashLoop });
    ctx.deps.spawnGate = gate;
    mockExecuteStartAgent.mockResolvedValue({ result: 'ok', failed: false });
  });

  test('passes through and calls executeStartAgent when all checks pass', async () => {
    const request = createRequest();
    const result = await gate.requestSpawn(ctx, request);

    expect(result).toEqual({ spawned: true, reason: 'ok' });
    expect(mockExecuteStartAgent).toHaveBeenCalledOnce();
    expect(mockExecuteStartAgent).toHaveBeenCalledWith(ctx, {
      chatroomId: CHATROOM_ID,
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt-4',
      workingDir: '/tmp/test',
      reason: 'user.start',
    });
  });

  test('rejects expired deadline', async () => {
    const request = createRequest({ deadline: Date.now() - 1000 });
    const result = await gate.requestSpawn(ctx, request);

    expect(result).toEqual({ spawned: false, reason: 'expired' });
    expect(mockExecuteStartAgent).not.toHaveBeenCalled();
  });

  test('does not check deadline when not set', async () => {
    const request = createRequest({ deadline: undefined });
    const result = await gate.requestSpawn(ctx, request);

    expect(result).toEqual({ spawned: true, reason: 'ok' });
    expect(mockExecuteStartAgent).toHaveBeenCalledOnce();
  });

  test('rejects when rate limited', async () => {
    (spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>).mockReturnValue({ allowed: false });
    const request = createRequest();
    const result = await gate.requestSpawn(ctx, request);

    expect(result).toEqual({ spawned: false, reason: 'rate_limited' });
    expect(mockExecuteStartAgent).not.toHaveBeenCalled();
  });

  test('rejects when crash loop detected for platform.crash_recovery', async () => {
    // Fill up the crash loop tracker beyond the limit (default 3)
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');

    const request = createRequest({ reason: 'platform.crash_recovery' });
    const result = await gate.requestSpawn(ctx, request);

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('crash_loop');
    expect(result.restartCount).toBeGreaterThan(0);
    expect(mockExecuteStartAgent).not.toHaveBeenCalled();

    // Should have emitted restartLimitReached event
    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({
        chatroomId: CHATROOM_ID,
        role: 'builder',
        restartCount: expect.any(Number),
        windowMs: expect.any(Number),
      })
    );
  });

  test('does NOT check crash loop for user.start reason', async () => {
    // Fill up the crash loop tracker beyond the limit
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');

    const request = createRequest({ reason: 'user.start' });
    const result = await gate.requestSpawn(ctx, request);

    // Should pass — crash loop check is only for platform.crash_recovery
    expect(result).toEqual({ spawned: true, reason: 'ok' });
    expect(mockExecuteStartAgent).toHaveBeenCalledOnce();
  });

  test('clearCrashLoop delegates to CrashLoopTracker.clear', () => {
    // Record some restarts
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    expect(crashLoop.getCount(CHATROOM_ID, 'builder')).toBe(2);

    gate.clearCrashLoop(CHATROOM_ID, 'builder');

    expect(crashLoop.getCount(CHATROOM_ID, 'builder')).toBe(0);
  });

  test('returns spawn_failed when executeStartAgent returns failed', async () => {
    mockExecuteStartAgent.mockResolvedValue({ result: 'error', failed: true });

    const request = createRequest();
    const result = await gate.requestSpawn(ctx, request);

    expect(result).toEqual({ spawned: false, reason: 'spawn_failed' });
    expect(mockExecuteStartAgent).toHaveBeenCalledOnce();
  });

  test('checks gates in order: deadline before rate limit', async () => {
    (spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>).mockReturnValue({ allowed: false });
    const request = createRequest({ deadline: Date.now() - 1000 });
    const result = await gate.requestSpawn(ctx, request);

    // Should fail with expired (checked first), not rate_limited
    expect(result.reason).toBe('expired');
    // shouldAllowSpawn should not have been called
    expect(spawning.shouldAllowSpawn).not.toHaveBeenCalled();
  });

  test('checks gates in order: rate limit before crash loop', async () => {
    (spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>).mockReturnValue({ allowed: false });

    // Fill crash loop
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');
    crashLoop.record(CHATROOM_ID, 'builder');

    const request = createRequest({ reason: 'platform.crash_recovery' });
    const result = await gate.requestSpawn(ctx, request);

    // Should fail with rate_limited (checked before crash loop)
    expect(result.reason).toBe('rate_limited');
    expect(mockExecuteStartAgent).not.toHaveBeenCalled();
  });
});
