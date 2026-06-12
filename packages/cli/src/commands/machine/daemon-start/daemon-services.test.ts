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

import { daemonContextToLayers } from './daemon-layers.js';
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
      backend: { mutation: vi.fn(), query: vi.fn() } as any,
      fs: { stat: vi.fn() } as any,
      agentServices: new Map(),
      events: {} as any,
      lastPushedGitState: new Map(),
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
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

  it('exposes flat backend and fs deps (no ctx.deps indirection)', () => {
    const backendMock = { mutation: vi.fn(), query: vi.fn() } as any;
    const fsMock = { stat: vi.fn() } as any;

    const layer = Layer.succeed(DaemonSessionService, {
      sessionId: 'sess-e3',
      machineId: 'machine-e3',
      client: {},
      config: null,
      backend: backendMock,
      fs: fsMock,
      agentServices: new Map(),
      events: {} as any,
      lastPushedGitState: new Map(),
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
    });

    const { backend, fs } = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return { backend: svc.backend, fs: svc.fs };
      }).pipe(Effect.provide(layer))
    );

    expect(backend).toBe(backendMock);
    expect(fs).toBe(fsMock);
  });

  it('exposes mutable state maps with shared reference semantics', () => {
    const lastPushedGitState = new Map<string, string>();
    lastPushedGitState.set('key', 'value');

    const layer = Layer.succeed(DaemonSessionService, {
      sessionId: 'sess-e3b',
      machineId: 'machine-e3b',
      client: {},
      config: null,
      backend: { mutation: vi.fn(), query: vi.fn() } as any,
      fs: { stat: vi.fn() } as any,
      agentServices: new Map(),
      events: {} as any,
      lastPushedGitState,
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
    });

    const result = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return svc.lastPushedGitState.get('key');
      }).pipe(Effect.provide(layer))
    );

    expect(result).toBe('value');
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

  it('populates flat backend/fs from ctx.deps (E3 extension)', async () => {
    const deps = createMockDaemonDeps();
    const ctx = createMockDaemonContext({ deps });

    const layer = daemonContextToLayers(ctx);
    const { backend, fs } = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return { backend: svc.backend, fs: svc.fs };
      }).pipe(Effect.provide(layer))
    );

    expect(backend).toBe(deps.backend);
    expect(fs).toBe(deps.fs);
  });

  it('populates lastPushedGitState with same reference as ctx (shared mutation)', async () => {
    const deps = createMockDaemonDeps();
    const lastPushedGitState = new Map<string, string>([['k', 'v']]);
    const ctx = createMockDaemonContext({ deps, lastPushedGitState });

    const layer = daemonContextToLayers(ctx);
    const map = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* DaemonSessionService;
        return svc.lastPushedGitState;
      }).pipe(Effect.provide(layer))
    );

    expect(map).toBe(lastPushedGitState);
    expect(map.get('k')).toBe('v');
  });
});
