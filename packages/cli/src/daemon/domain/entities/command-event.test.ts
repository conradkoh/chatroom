import { describe, expect, test } from 'vitest';

import {
  DAEMON_COMMAND_EVENT_TYPES,
  isCommandEvent,
  isDaemonCommandEventType,
} from './command-event.js';

describe('command-event', () => {
  test('isDaemonCommandEventType accepts all known types', () => {
    for (const type of DAEMON_COMMAND_EVENT_TYPES) {
      expect(isDaemonCommandEventType(type)).toBe(true);
    }
  });

  test('isDaemonCommandEventType rejects unknown types', () => {
    expect(isDaemonCommandEventType('agent.unknown')).toBe(false);
    expect(isDaemonCommandEventType('')).toBe(false);
  });

  test('isCommandEvent accepts object with known type', () => {
    expect(
      isCommandEvent({
        commandId: 'cmd1',
        machineId: 'machine1',
        type: 'daemon.ping',
        deadline: 1000,
        timestamp: 500,
      })
    ).toBe(true);
  });

  test('isCommandEvent rejects unknown type', () => {
    expect(
      isCommandEvent({
        commandId: 'cmd1',
        type: 'unknown.event',
      })
    ).toBe(false);
  });

  test('isCommandEvent rejects non-objects', () => {
    expect(isCommandEvent(null)).toBe(false);
    expect(isCommandEvent('daemon.ping')).toBe(false);
    expect(isCommandEvent(undefined)).toBe(false);
  });
});
