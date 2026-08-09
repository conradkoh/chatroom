import { describe, expect, it, vi } from 'vitest';

import { handleTurnEnd } from './handle-turn-end.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

describe('handleTurnEnd', () => {
  it('appends a turn.ended lifecycle event when a native turn ends', () => {
    const events: OutboundEvent[] = [];
    const result = handleTurnEnd(
      {
        machineId: 'machine-1',
        appendLifecycleEvent: (event) => events.push(event),
        injectHandoffReminder: vi.fn(),
        now: () => 1000,
      },
      { chatroomId: 'room-1', role: 'builder', taskId: 'task-1', hasInFlightWork: true }
    );

    expect(result.reminderScheduled).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('turn.ended');
    if (events[0]?.type === 'turn.ended') {
      expect(events[0]).toEqual({
        type: 'turn.ended',
        idempotencyKey: 'room-1:builder:turn_ended_1000',
        chatroomId: 'room-1',
        role: 'builder',
        machineId: 'machine-1',
        taskId: 'task-1',
        timestamp: 1000,
      });
    }
  });

  it('injects the missed-handoff reminder when in-flight work remains', () => {
    const injectHandoffReminder = vi.fn();
    handleTurnEnd(
      {
        machineId: 'machine-1',
        appendLifecycleEvent: vi.fn(),
        injectHandoffReminder,
        now: () => 1000,
      },
      { chatroomId: 'room-1', role: 'planner', hasInFlightWork: true }
    );

    expect(injectHandoffReminder).toHaveBeenCalledWith('room-1', 'planner');
  });

  it('does not inject the reminder when there is no in-flight work', () => {
    const injectHandoffReminder = vi.fn();
    const result = handleTurnEnd(
      {
        machineId: 'machine-1',
        appendLifecycleEvent: vi.fn(),
        injectHandoffReminder,
        now: () => 1000,
      },
      { chatroomId: 'room-1', role: 'builder', hasInFlightWork: false }
    );

    expect(result.reminderScheduled).toBe(false);
    expect(injectHandoffReminder).not.toHaveBeenCalled();
  });
});
