import { describe, expect, it } from 'vitest';

import {
  isSupportedEventType,
  SUPPORTED_EVENT_TYPE_NAMES,
  SUPPORTED_EVENT_TYPES,
} from './event-type';

describe('event-type', () => {
  it('lists every chatroom_eventStream type surfaced in the event stream UI', () => {
    expect(SUPPORTED_EVENT_TYPE_NAMES).toHaveLength(26);
    expect(Object.keys(SUPPORTED_EVENT_TYPES)).toHaveLength(26);
  });

  it('isSupportedEventType narrows supported keys', () => {
    expect(isSupportedEventType('command.run')).toBe(true);
    expect(isSupportedEventType('not.real')).toBe(false);
  });
});
