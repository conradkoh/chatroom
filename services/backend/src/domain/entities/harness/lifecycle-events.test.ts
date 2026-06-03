import { describe, expect, test } from 'vitest';

import {
  HARNESS_WIRE_EVENT_SPECS,
  wireEventEmittedByRuntime,
  wireEventToLifecycle,
} from './lifecycle-events.js';

describe('harness lifecycle wire events', () => {
  test('wire.ndjson.agent_end is CLI-only and maps to lifecycle.turn.completed', () => {
    const spec = HARNESS_WIRE_EVENT_SPECS['wire.ndjson.agent_end'];
    expect(spec.cliOnly).toBe(true);
    expect(spec.emittedBy).toEqual(['cli']);
    expect(wireEventEmittedByRuntime('wire.ndjson.agent_end', 'sdk')).toBe(false);
    expect(wireEventToLifecycle('wire.ndjson.agent_end')).toBe('lifecycle.turn.completed');
  });

  test('sdk.cursor.run.completed is SDK-only and maps to lifecycle.turn.completed', () => {
    const spec = HARNESS_WIRE_EVENT_SPECS['sdk.cursor.run.completed'];
    expect(spec.cliOnly).toBe(false);
    expect(spec.emittedBy).toEqual(['sdk']);
    expect(wireEventEmittedByRuntime('sdk.cursor.run.completed', 'cli')).toBe(false);
    expect(wireEventToLifecycle('sdk.cursor.run.completed')).toBe('lifecycle.turn.completed');
  });
});
