/**
 * Harness capabilities — unit tests
 */

import { describe, expect, test } from 'vitest';

import { AGENT_HARNESSES } from '../agent';
import { CLI_ONLY_WIRE_EVENT_KINDS, isCliOnlyWireEvent } from './lifecycle-events';
import { getHarnessCapabilities, getHarnessRuntimeKind, isNativeHarness } from './types';

describe('getHarnessCapabilities', () => {
  test('every AgentHarness has a capabilities entry', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(getHarnessCapabilities(harness)).toBeDefined();
    }
  });

  test('opencode-sdk, pi, and cursor-sdk support session resume', () => {
    for (const harness of ['opencode-sdk', 'pi', 'cursor-sdk'] as const) {
      expect(getHarnessCapabilities(harness).supportsSessionResume).toBe(true);
    }
  });

  test('all other harnesses do not support session resume', () => {
    const nonResumable = AGENT_HARNESSES.filter(
      (h) => h !== 'opencode-sdk' && h !== 'pi' && h !== 'cursor-sdk'
    );
    for (const harness of nonResumable) {
      expect(getHarnessCapabilities(harness).supportsSessionResume).toBe(false);
    }
  });

  test('cursor-sdk and opencode-sdk support native integration', () => {
    expect(getHarnessCapabilities('cursor-sdk').supportsNativeIntegration).toBe(true);
    expect(getHarnessCapabilities('opencode-sdk').supportsNativeIntegration).toBe(true);
  });

  test('all other harnesses do not support native integration', () => {
    const nonNative = AGENT_HARNESSES.filter((h) => h !== 'cursor-sdk' && h !== 'opencode-sdk');
    for (const harness of nonNative) {
      expect(getHarnessCapabilities(harness).supportsNativeIntegration).toBe(false);
    }
  });

  test('SDK harnesses use runtimeKind sdk', () => {
    expect(getHarnessRuntimeKind('cursor-sdk')).toBe('sdk');
    expect(getHarnessRuntimeKind('opencode-sdk')).toBe('sdk');
  });

  test('CLI harnesses use runtimeKind cli', () => {
    for (const harness of ['pi', 'opencode', 'cursor', 'claude'] as const) {
      expect(getHarnessRuntimeKind(harness)).toBe('cli');
    }
  });

  test('SDK harnesses never declare CLI-only NDJSON wire events', () => {
    for (const harness of ['cursor-sdk', 'opencode-sdk'] as const) {
      const { wireEvents } = getHarnessCapabilities(harness);
      for (const kind of wireEvents) {
        expect(isCliOnlyWireEvent(kind)).toBe(false);
      }
    }
  });

  test('Pi is the only harness that emits wire.ndjson.agent_end', () => {
    const withNdjsonAgentEnd = AGENT_HARNESSES.filter((h) =>
      getHarnessCapabilities(h).wireEvents.includes('wire.ndjson.agent_end')
    );
    expect(withNdjsonAgentEnd).toEqual(['pi']);
  });

  test('every CLI-only wire kind is marked cliOnly in the catalog', () => {
    for (const kind of CLI_ONLY_WIRE_EVENT_KINDS) {
      expect(isCliOnlyWireEvent(kind)).toBe(true);
    }
  });
});

describe('isNativeHarness', () => {
  test('returns true for sdk harnesses', () => {
    expect(isNativeHarness('cursor-sdk')).toBe(true);
    expect(isNativeHarness('opencode-sdk')).toBe(true);
  });

  test('returns false for cli harnesses and undefined', () => {
    expect(isNativeHarness('cursor')).toBe(false);
    expect(isNativeHarness(undefined)).toBe(false);
  });
});
