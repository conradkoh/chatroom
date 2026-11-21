import { describe, expect, test } from 'vitest';

import {
  HARNESS_WIRE_EVENT_KINDS,
  HARNESS_WIRE_EVENT_SPECS,
  wireEventToLifecycle,
} from './lifecycle-events';

describe('harness lifecycle wire events', () => {
  test('wire.log.agent_end maps to lifecycle.turn.completed', () => {
    expect(wireEventToLifecycle('wire.log.agent_end')).toBe('lifecycle.turn.completed');
  });

  test('sdk.cursor.run.completed maps to lifecycle.turn.completed', () => {
    expect(wireEventToLifecycle('sdk.cursor.run.completed')).toBe('lifecycle.turn.completed');
  });

  test('every catalogued wire event has a description', () => {
    for (const kind of HARNESS_WIRE_EVENT_KINDS) {
      expect(HARNESS_WIRE_EVENT_SPECS[kind].description.length).toBeGreaterThan(0);
    }
  });
});
