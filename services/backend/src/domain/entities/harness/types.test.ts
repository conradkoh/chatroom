/**
 * Harness capabilities — unit tests
 */

import { describe, expect, test } from 'vitest';

import { AGENT_HARNESSES } from '../agent';
import { HARNESS_WIRE_EVENT_KINDS } from './lifecycle-events';
import { getHarnessCapabilities, isNativeHarness } from './types';

describe('AGENT_HARNESSES', () => {
  test('is exactly the five SDK harnesses', () => {
    expect([...AGENT_HARNESSES].sort()).toEqual([
      'claude-sdk',
      'codex-sdk',
      'cursor-sdk',
      'opencode-sdk',
      'pi-sdk',
    ]);
  });
});

describe('getHarnessCapabilities', () => {
  test('every AgentHarness has a capabilities entry', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(getHarnessCapabilities(harness)).toBeDefined();
    }
  });

  test('every declared wire event is a catalogued kind', () => {
    for (const harness of AGENT_HARNESSES) {
      for (const kind of getHarnessCapabilities(harness).wireEvents) {
        expect(HARNESS_WIRE_EVENT_KINDS).toContain(kind);
      }
    }
  });
});

describe('isNativeHarness', () => {
  test('returns true for every AgentHarness', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(isNativeHarness(harness)).toBe(true);
    }
  });

  test('returns false for undefined, null, and unknown names', () => {
    expect(isNativeHarness(undefined)).toBe(false);
    expect(isNativeHarness(null)).toBe(false);
    expect(isNativeHarness('legacy-harness')).toBe(false);
  });
});
