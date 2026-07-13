import { describe, expect, it } from 'vitest';

import {
  isSupportedEventType,
  SUPPORTED_EVENT_TYPE_NAMES,
  SUPPORTED_EVENT_TYPES,
} from './event-type';

describe('event-type', () => {
  it('lists every chatroom_eventStream type surfaced in the event stream UI', () => {
    expect(SUPPORTED_EVENT_TYPE_NAMES).toHaveLength(44);
    expect(Object.keys(SUPPORTED_EVENT_TYPES)).toHaveLength(44);
  });

  it('includes recently added agent lifecycle event types', () => {
    expect(isSupportedEventType('agent.awaitingHandoff')).toBe(true);
    expect(isSupportedEventType('agent.stopTimeout')).toBe(true);
    expect(isSupportedEventType('agent.harnessSessionIdUpdated')).toBe(true);
    expect(isSupportedEventType('agent.taskDelivered')).toBe(true);
    expect(isSupportedEventType('agent.taskDeliveryFailed')).toBe(true);
  });

  it('isSupportedEventType narrows supported keys', () => {
    expect(isSupportedEventType('command.run')).toBe(true);
    expect(isSupportedEventType('not.real')).toBe(false);
  });
});
