import { describe, expect, it } from 'vitest';

import { transitionSlot, shouldIgnoreProcessExit } from './slot-transitions.js';
import type { AgentSlotSnapshot } from '../entities/agent-slot.js';
import { idleSlot } from '../entities/agent-slot.js';

function unwrapOk(result: ReturnType<typeof transitionSlot>): AgentSlotSnapshot {
  if (!result.ok) {
    throw new Error(`Expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.slot;
}

function unwrapError(result: ReturnType<typeof transitionSlot>): { _tag: string } {
  if (result.ok) {
    throw new Error('Expected error result, got ok');
  }
  return result.error as { _tag: string };
}

describe('transitionSlot — idle state', () => {
  it('ensure_running_requested stays idle', () => {
    const slot = idleSlot();
    const result = transitionSlot(slot, { type: 'ensure_running_requested' });
    expect(unwrapOk(result).state).toBe('idle');
  });

  it('spawn_started transitions to spawning', () => {
    const slot = idleSlot();
    const result = transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' });
    const s = unwrapOk(result);
    expect(s.state).toBe('spawning');
    expect(s.pendingOperationKey).toBe('op-1');
  });

  it('process_exited on idle with no pid is a no-op', () => {
    const slot = idleSlot();
    const result = transitionSlot(slot, { type: 'process_exited', pid: 999 });
    expect(unwrapOk(result).state).toBe('idle');
  });
});

describe('transitionSlot — spawning state', () => {
  it('spawn_succeeded transitions to running with pid', () => {
    const slot = unwrapOk(
      transitionSlot(idleSlot(), { type: 'spawn_started', operationKey: 'op-1' })
    );
    const result = transitionSlot(slot, { type: 'spawn_succeeded', pid: 123 });
    const s = unwrapOk(result);
    expect(s.state).toBe('running');
    expect(s.pid).toBe(123);
  });

  it('spawn_failed returns to idle', () => {
    const slot = unwrapOk(
      transitionSlot(idleSlot(), { type: 'spawn_started', operationKey: 'op-1' })
    );
    const result = transitionSlot(slot, { type: 'spawn_failed' });
    expect(unwrapOk(result).state).toBe('idle');
  });

  it('process_exited during spawning returns to idle', () => {
    const slot = unwrapOk(
      transitionSlot(idleSlot(), { type: 'spawn_started', operationKey: 'op-1' })
    );
    const result = transitionSlot(slot, { type: 'process_exited', pid: 999 });
    expect(unwrapOk(result).state).toBe('idle');
  });
});

describe('transitionSlot — full happy path', () => {
  it('idle → spawning → running → stopping → idle', () => {
    let slot: AgentSlotSnapshot = idleSlot();

    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    expect(slot.state).toBe('spawning');

    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));
    expect(slot.state).toBe('running');
    expect(slot.pid).toBe(42);

    slot = unwrapOk(transitionSlot(slot, { type: 'stop_requested', operationKey: 'op-2' }));
    expect(slot.state).toBe('stopping');

    slot = unwrapOk(transitionSlot(slot, { type: 'stop_completed' }));
    expect(slot.state).toBe('idle');
  });
});

describe('transitionSlot — crash path', () => {
  it('running → process_exited → idle', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));

    const result = transitionSlot(slot, { type: 'process_exited', pid: 42 });
    expect(unwrapOk(result).state).toBe('idle');
  });
});

describe('transitionSlot — duplicate exit ignored when stopping', () => {
  it('returns error when process exits while stopping', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));
    slot = unwrapOk(transitionSlot(slot, { type: 'stop_requested', operationKey: 'op-2' }));

    const result = transitionSlot(slot, { type: 'process_exited', pid: 42 });
    expect(unwrapError(result)._tag).toBe('IgnoredDuplicateExit');
  });
});

describe('transitionSlot — stale pid exit ignored', () => {
  it('returns StalePid when pid does not match', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));

    const result = transitionSlot(slot, { type: 'process_exited', pid: 999 });
    expect(unwrapError(result)._tag).toBe('StalePid');
  });
});

describe('transitionSlot — spawn_failed returns to idle', () => {
  it('returns to idle from spawning', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    const result = transitionSlot(slot, { type: 'spawn_failed' });
    expect(unwrapOk(result).state).toBe('idle');
  });
});

describe('transitionSlot — stale_process_detected clears running slot', () => {
  it('transitions running → idle', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));

    const result = transitionSlot(slot, { type: 'stale_process_detected' });
    const s = unwrapOk(result);
    expect(s.state).toBe('idle');
    expect(s.pid).toBeUndefined();
  });
});

describe('shouldIgnoreProcessExit', () => {
  it('returns false when state is not stopping', () => {
    const slot = idleSlot();
    expect(shouldIgnoreProcessExit(slot, 42)).toBe(false);
  });

  it('returns true when state is stopping and pid matches', () => {
    let slot: AgentSlotSnapshot = idleSlot();
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_started', operationKey: 'op-1' }));
    slot = unwrapOk(transitionSlot(slot, { type: 'spawn_succeeded', pid: 42 }));
    slot = unwrapOk(transitionSlot(slot, { type: 'stop_requested', operationKey: 'op-2' }));

    expect(shouldIgnoreProcessExit(slot, 42)).toBe(true);
  });

  it('returns true when state is stopping but pid is undefined (any pid ignored)', () => {
    const slot: AgentSlotSnapshot = { state: 'stopping' };
    expect(shouldIgnoreProcessExit(slot, 42)).toBe(true);
  });
});
