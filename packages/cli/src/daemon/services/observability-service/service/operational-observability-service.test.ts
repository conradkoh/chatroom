import { describe, expect, it, vi } from 'vitest';

import {
  createOperationalObservabilityService,
  DEFAULT_OBSERVABILITY_ROLE_LIMIT,
  DEFAULT_OBSERVABILITY_SCOPE_LIMIT,
  type OperationalObservabilityService,
  type OperationalObservabilitySnapshot,
} from './operational-observability-service.js';

function makeClock(start = 1_000): { clock: () => number; advance: (ms: number) => void } {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeService(
  sinks: OperationalObservabilitySnapshot[] = [],
  start = 1_000,
  extra?: Partial<Parameters<typeof createOperationalObservabilityService>[0]>
): { service: OperationalObservabilityService; snapshots: OperationalObservabilitySnapshot[] } {
  const { clock } = makeClock(start);
  const service = createOperationalObservabilityService({
    machineId: 'machine-1',
    clock,
    sink: (snapshot) => {
      sinks.push(snapshot);
    },
    ...extra,
  });
  return { service, snapshots: sinks };
}

describe('operational observability service', () => {
  it('aggregates lifecycle, page, hydration, ack, error, and restart counters by chatroom', async () => {
    const { service, snapshots } = makeService();
    service.subscriptionStarted('room-1');
    service.subscriptionStarted('room-2');
    service.subscriptionStopped('room-2');
    service.signalPageReceived('room-1', [
      { role: 'builder', projectedAt: 100 },
      { role: 'builder', projectedAt: 101 },
      { role: 'planner', projectedAt: 102 },
    ]);
    service.hydrationCompleted('room-1', { rowCount: 3, removedRowCount: 1 });
    service.acknowledgementAttempted('room-1');
    service.loopError('room-2');
    service.loopRestart('room-2');

    await service.flush();
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0]!;
    expect(snapshot.type).toBe('daemon.observability.operational-signals');
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.machineId).toBe('machine-1');
    expect(snapshot.activeSubscriptions).toBe(1);
    expect(snapshot.totals).toMatchObject({
      subscriptionStarts: 2,
      subscriptionStops: 1,
      pageCount: 1,
      signalCount: 3,
      hydrationCount: 1,
      hydratedRowCount: 3,
      removedRowCount: 1,
      acknowledgementCount: 1,
      errorCount: 1,
      restartCount: 1,
    });
    const room1 = snapshot.scopes.find((scope) => scope.chatroomId === 'room-1');
    expect(room1).toMatchObject({
      pageCount: 1,
      signalCount: 3,
      hydrationCount: 1,
      hydratedRowCount: 3,
      removedRowCount: 1,
      acknowledgementCount: 1,
    });
    expect(room1?.roleCounts).toEqual({ builder: 2, planner: 1 });
    expect(room1?.lastSignalAt).toBe(102);
  });

  it('snapshot() is non-mutating', async () => {
    const { service, snapshots } = makeService();
    service.signalPageReceived('room-1', [{ role: 'builder', projectedAt: 50 }]);
    const first = service.snapshot();
    const second = service.snapshot();
    expect(second).toEqual(first);
    // A snapshot must not reset interval state: flush still emits.
    await service.flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({ ...first, timestamp: first.timestamp });
  });

  it('flush emits exactly one aggregate record and resets interval counters', async () => {
    const { service, snapshots } = makeService();
    service.subscriptionStarted('room-1');
    service.signalPageReceived('room-1', [{ role: 'builder', projectedAt: 10 }]);
    service.signalPageReceived('room-1', [{ role: 'planner', projectedAt: 11 }]);
    service.acknowledgementAttempted('room-1');

    await service.flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.totals.signalCount).toBe(2);

    // Interval counters reset but the subscription gauge is preserved.
    const after = service.snapshot();
    expect(after.activeSubscriptions).toBe(1);
    expect(after.totals.signalCount).toBe(0);
    expect(after.scopes).toHaveLength(0);

    await service.flush();
    expect(snapshots).toHaveLength(1);
  });

  it('a failed sink does not lose counters; the next flush retries the same evidence', async () => {
    const snapshots: OperationalObservabilitySnapshot[] = [];
    const { clock } = makeClock();
    let failures = 1;
    const service = createOperationalObservabilityService({
      machineId: 'machine-1',
      clock,
      sink: (snapshot) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('sink unavailable');
        }
        snapshots.push(snapshot);
      },
    });
    service.signalPageReceived('room-1', [{ role: 'builder', projectedAt: 10 }]);

    await expect(service.flush()).rejects.toThrow('sink unavailable');
    expect(snapshots).toHaveLength(0);

    await service.flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.totals.signalCount).toBe(1);
  });

  it('supports async sinks', async () => {
    const snapshots: OperationalObservabilitySnapshot[] = [];
    const { clock } = makeClock();
    const service = createOperationalObservabilityService({
      machineId: 'machine-1',
      clock,
      sink: async (snapshot) => {
        await Promise.resolve();
        snapshots.push(snapshot);
      },
    });
    service.acknowledgementAttempted('room-1');
    await service.flush();
    expect(snapshots).toHaveLength(1);
  });

  it('empty flush does not call the sink', async () => {
    const sink = vi.fn();
    const { clock } = makeClock();
    const service = createOperationalObservabilityService({
      machineId: 'machine-1',
      clock,
      sink,
    });
    await service.flush();
    expect(sink).not.toHaveBeenCalled();
  });

  it('scope and role limits produce deterministic __other__ buckets and bounded output', async () => {
    const { service, snapshots } = makeService([], 1_000, {
      scopeLimit: 2,
      roleLimit: 1,
    });
    service.signalPageReceived('room-a', [{ role: 'builder', projectedAt: 1 }]);
    service.signalPageReceived('room-b', [{ role: 'builder', projectedAt: 2 }]);
    service.signalPageReceived('room-c', [{ role: 'builder', projectedAt: 3 }]);
    service.signalPageReceived('room-d', [
      { role: 'builder', projectedAt: 4 },
      { role: 'planner', projectedAt: 5 },
      { role: 'reviewer', projectedAt: 6 },
    ]);

    await service.flush();
    expect(snapshots).toHaveLength(1);
    const scopes = snapshots[0]!.scopes;
    expect(scopes.map((scope) => scope.chatroomId).sort()).toEqual([
      '__other__',
      'room-a',
      'room-b',
    ]);
    expect(scopes.length).toBeLessThanOrEqual(3);
    const other = scopes.find((scope) => scope.chatroomId === '__other__');
    // room-c (1 signal) plus room-d (3 signals) aggregate into __other__.
    expect(other?.signalCount).toBe(4);
    // roleLimit 1: builder keeps its bucket, planner/reviewer fold into __other__.
    expect(other?.roleCounts).toEqual({ builder: 2, __other__: 2 });
    expect(snapshots[0]!.totals.signalCount).toBe(6);
  });

  it('defaults scope and role limits when invalid values are provided', async () => {
    const { service, snapshots } = makeService([], 1_000, {
      scopeLimit: -3,
      roleLimit: Number.NaN,
    });
    for (let i = 0; i < DEFAULT_OBSERVABILITY_SCOPE_LIMIT + 5; i += 1) {
      service.signalPageReceived(`room-${i}`, [{ role: `role-${i}`, projectedAt: i }]);
    }
    await service.flush();
    expect(snapshots).toHaveLength(1);
    // 64 owned scopes plus one __other__ bucket.
    expect(snapshots[0]!.scopes).toHaveLength(DEFAULT_OBSERVABILITY_SCOPE_LIMIT + 1);
    for (const scope of snapshots[0]!.scopes) {
      expect(Object.keys(scope.roleCounts).length).toBeLessThanOrEqual(
        DEFAULT_OBSERVABILITY_ROLE_LIMIT + 1
      );
    }
  });

  it('clamps the active subscription gauge at zero', async () => {
    const { service, snapshots } = makeService();
    service.subscriptionStopped('room-1');
    await service.flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.activeSubscriptions).toBe(0);
    expect(snapshots[0]?.totals.subscriptionStops).toBe(1);
  });
});
