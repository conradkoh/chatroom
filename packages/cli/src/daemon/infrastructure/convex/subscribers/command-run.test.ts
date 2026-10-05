import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';
import { startCommandRunSubscriber } from './command-run.js';

type UpdateCallback = (result: unknown) => void;

function createSubscriberMock() {
  let update!: UpdateCallback;
  const unsubscribe = vi.fn();
  const wsClient = {
    onUpdate: vi.fn((_query, _args, callback: UpdateCallback) => {
      update = callback;
      return unsubscribe;
    }),
  } as unknown as ConvexClient;
  const deps: ConvexSubscriberDeps = {
    wsClient,
    sessionId: 'session-test' as SessionId,
    machineId: 'machine-test',
  };
  return { deps, emit: (result: unknown) => update(result), unsubscribe };
}

const event = (runId: string): InboundEvent => ({ type: 'command-run.updated', runId });

describe('command-run subscriber', () => {
  it('emits once for pending and again for a later stop of the same run', () => {
    const mock = createSubscriberMock();
    const events: InboundEvent[] = [];
    startCommandRunSubscriber(mock.deps, (next) => events.push(next));

    mock.emit({ pendingRuns: [{ _id: 'run-1' }], stopRequestedRuns: [] });
    mock.emit({ pendingRuns: [{ _id: 'run-1' }], stopRequestedRuns: [] });
    mock.emit({ pendingRuns: [], stopRequestedRuns: [] });
    mock.emit({ pendingRuns: [], stopRequestedRuns: [{ _id: 'run-1' }] });
    mock.emit({ pendingRuns: [], stopRequestedRuns: [{ _id: 'run-1' }] });

    expect(events).toEqual([event('run-1'), event('run-1')]);
  });

  it('emits an initial stop-only run once', () => {
    const mock = createSubscriberMock();
    const events: InboundEvent[] = [];
    startCommandRunSubscriber(mock.deps, (next) => events.push(next));

    mock.emit({ stopRequestedRuns: [{ _id: 'run-1' }] });
    mock.emit({ stopRequestedRuns: [{ _id: 'run-1' }] });

    expect(events).toEqual([event('run-1')]);
  });

  it('deduplicates each action independently across newer run IDs', () => {
    const mock = createSubscriberMock();
    const events: InboundEvent[] = [];
    startCommandRunSubscriber(mock.deps, (next) => events.push(next));

    mock.emit({ pendingRuns: [{ _id: 'run-1' }] });
    mock.emit({ pendingRuns: [{ _id: 'run-2' }] });
    mock.emit({ stopRequestedRuns: [{ _id: 'run-2' }] });

    expect(events).toEqual([event('run-1'), event('run-2'), event('run-2')]);
  });

  it('emits distinct pending and stop IDs and ignores absent or empty inputs', () => {
    const mock = createSubscriberMock();
    const events: InboundEvent[] = [];
    startCommandRunSubscriber(mock.deps, (next) => events.push(next));

    mock.emit(null);
    mock.emit(undefined);
    mock.emit({ pendingRuns: [], stopRequestedRuns: [] });
    mock.emit({ pendingRuns: [{ _id: 'pending-1' }], stopRequestedRuns: [{ _id: 'stop-1' }] });

    expect(events).toEqual([event('pending-1'), event('stop-1')]);
  });

  it('normalizes object IDs consistently across pending and stop actions', () => {
    const mock = createSubscriberMock();
    const events: InboundEvent[] = [];
    startCommandRunSubscriber(mock.deps, (next) => events.push(next));

    mock.emit({ pendingRuns: [{ _id: { toString: () => 'run-1' } }] });
    mock.emit({ stopRequestedRuns: [{ _id: { toString: () => 'run-1' } }] });

    expect(events).toEqual([event('run-1'), event('run-1')]);
  });

  it('unsubscribes when stopped', async () => {
    const mock = createSubscriberMock();
    const handle = startCommandRunSubscriber(mock.deps, () => {});

    await handle.stop();

    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});
