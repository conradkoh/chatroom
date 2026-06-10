/**
 * Daemon Services Tests (Phase E1)
 *
 * Tests for the four new daemon-specific Effect services and the
 * daemonContextToLayers() convenience builder:
 *
 *   - DaemonMachineService
 *   - DaemonSpawningService
 *   - DaemonAgentProcessManagerService
 *   - DaemonSessionService
 *   - daemonContextToLayers()
 */

import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { DaemonContextService, daemonContextToLayers } from './daemon-context-service.js';
import {
  DaemonAgentProcessManagerService,
  DaemonAgentProcessManagerServiceLive,
  DaemonMachineService,
  DaemonMachineServiceLive,
  DaemonSessionService,
  DaemonSpawningService,
  DaemonSpawningServiceLive,
} from './daemon-services.js';
import { createMockDaemonContext } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';

// ---------------------------------------------------------------------------
// A. DaemonMachineService
// ---------------------------------------------------------------------------

describe('DaemonMachineService', () => {
  it('listAgentEntries delegates to underlying MachineStateOps', async () => {
    const expectedEntries = [
      { chatroomId: 'room-1', role: 'builder', entry: { pid: 1234, harness: 'pi' as any } },
    ];
    const ops = {
      clearAgentPid: vi.fn().mockResolvedValue(undefined),
      persistAgentPid: vi.fn().mockResolvedValue(undefined),
      listAgentEntries: vi.fn().mockResolvedValue(expectedEntries),
      persistEventCursor: vi.fn().mockResolvedValue(undefined),
      loadEventCursor: vi.fn().mockResolvedValue(null),
    };

    const layer = DaemonMachineServiceLive(ops);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonMachineService;
        return yield* svc.listAgentEntries('machine-e1');
      }).pipe(Effect.provide(layer))
    );

    expect(result).toEqual(expectedEntries);
    expect(ops.listAgentEntries).toHaveBeenCalledWith('machine-e1');
  });

  it('clearAgentPid delegates to underlying MachineStateOps', async () => {
    const ops = {
      clearAgentPid: vi.fn().mockResolvedValue(undefined),
      persistAgentPid: vi.fn().mockResolvedValue(undefined),
      listAgentEntries: vi.fn().mockResolvedValue([]),
      persistEventCursor: vi.fn().mockResolvedValue(undefined),
      loadEventCursor: vi.fn().mockResolvedValue(null),
    };

    const layer = DaemonMachineServiceLive(ops);
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonMachineService;
        yield* svc.clearAgentPid('m-1', 'room-2', 'planner');
      }).pipe(Effect.provide(layer))
    );

    expect(ops.clearAgentPid).toHaveBeenCalledWith('m-1', 'room-2', 'planner');
  });

  it('loadEventCursor returns null when no cursor is persisted', async () => {
    const ops = {
      clearAgentPid: vi.fn().mockResolvedValue(undefined),
      persistAgentPid: vi.fn().mockResolvedValue(undefined),
      listAgentEntries: vi.fn().mockResolvedValue([]),
      persistEventCursor: vi.fn().mockResolvedValue(undefined),
      loadEventCursor: vi.fn().mockResolvedValue(null),
    };

    const layer = DaemonMachineServiceLive(ops);
    const cursor = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonMachineService;
        return yield* svc.loadEventCursor('machine-e1-cursor');
      }).pipe(Effect.provide(layer))
    );

    expect(cursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. DaemonSpawningService
// ---------------------------------------------------------------------------

describe('DaemonSpawningService', () => {
  it('shouldAllowSpawn delegates to underlying SpawningOps and returns allowed=true', () => {
    const ops = {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
      getConcurrentCount: vi.fn().mockReturnValue(0),
    };

    const layer = DaemonSpawningServiceLive(ops);
    const result = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonSpawningService;
        return svc.shouldAllowSpawn('room-spawn', 'user.start');
      }).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ allowed: true });
    expect(ops.shouldAllowSpawn).toHaveBeenCalledWith('room-spawn', 'user.start', undefined);
  });

  it('getConcurrentCount delegates to underlying SpawningOps', () => {
    const ops = {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
      getConcurrentCount: vi.fn().mockReturnValue(3),
    };

    const layer = DaemonSpawningServiceLive(ops);
    const count = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonSpawningService;
        return svc.getConcurrentCount('room-concurrent');
      }).pipe(Effect.provide(layer))
    );

    expect(count).toBe(3);
    expect(ops.getConcurrentCount).toHaveBeenCalledWith('room-concurrent');
  });
});

// ---------------------------------------------------------------------------
// C. DaemonAgentProcessManagerService
// ---------------------------------------------------------------------------

describe('DaemonAgentProcessManagerService', () => {
  it('recover() completes without error', async () => {
    const mockMgr = {
      ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 1 }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      handleExit: vi.fn().mockResolvedValue(undefined),
      recover: vi.fn().mockResolvedValue(undefined),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
    } as any;

    const layer = DaemonAgentProcessManagerServiceLive(mockMgr);
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonAgentProcessManagerService;
        yield* svc.recover();
      }).pipe(Effect.provide(layer))
    );

    expect(mockMgr.recover).toHaveBeenCalledOnce();
  });

  it('getSlot returns undefined for unknown agent', () => {
    const mockMgr = {
      ensureRunning: vi.fn(),
      stop: vi.fn(),
      handleExit: vi.fn(),
      recover: vi.fn(),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
    } as any;

    const layer = DaemonAgentProcessManagerServiceLive(mockMgr);
    const slot = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonAgentProcessManagerService;
        return svc.getSlot('room-unknown', 'builder');
      }).pipe(Effect.provide(layer))
    );

    expect(slot).toBeUndefined();
    expect(mockMgr.getSlot).toHaveBeenCalledWith('room-unknown', 'builder');
  });
});

// ---------------------------------------------------------------------------
// D. DaemonSessionService
// ---------------------------------------------------------------------------

describe('DaemonSessionService', () => {
  it('yields sessionId and machineId from the provided service shape', () => {
    const layer = Layer.succeed(DaemonSessionService, {
      sessionId: 'sess-e1',
      machineId: 'machine-e1',
      client: {},
      config: null,
      agentServices: new Map(),
      events: {} as any,
    });

    const { sessionId, machineId } = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return { sessionId: svc.sessionId, machineId: svc.machineId };
      }).pipe(Effect.provide(layer))
    );

    expect(sessionId).toBe('sess-e1');
    expect(machineId).toBe('machine-e1');
  });
});

// ---------------------------------------------------------------------------
// E. daemonContextToLayers()
// ---------------------------------------------------------------------------

describe('daemonContextToLayers', () => {
  it('builds a layer that provides DaemonSessionService with ctx identity fields', async () => {
    const deps = createMockDaemonDeps();
    const ctx = createMockDaemonContext({
      deps,
      sessionId: 'sess-from-ctx',
      machineId: 'machine-from-ctx',
    });

    const layer = daemonContextToLayers(ctx);
    const { sessionId, machineId } = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return { sessionId: svc.sessionId, machineId: svc.machineId };
      }).pipe(Effect.provide(layer))
    );

    expect(sessionId).toBe('sess-from-ctx');
    expect(machineId).toBe('machine-from-ctx');
  });

  it('builds a layer that provides DaemonContextService (backward-compat)', async () => {
    const deps = createMockDaemonDeps();
    const ctx = createMockDaemonContext({ deps, machineId: 'machine-compat' });

    const layer = daemonContextToLayers(ctx);
    const resolvedCtx = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* DaemonContextService;
      }).pipe(Effect.provide(layer))
    );

    expect(resolvedCtx.machineId).toBe('machine-compat');
    expect(resolvedCtx.deps).toBe(deps);
  });
});
