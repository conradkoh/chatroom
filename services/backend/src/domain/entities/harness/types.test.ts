/**
 * Harness capabilities — unit tests
 */

import { describe, expect, test } from 'vitest';

import { AGENT_HARNESSES } from '../agent.js';
import { getHarnessCapabilities } from './types.js';

describe('getHarnessCapabilities', () => {
  test('every AgentHarness has a capabilities entry', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(getHarnessCapabilities(harness)).toBeDefined();
    }
  });

  test('opencode-sdk, pi, and cursor-sdk support session resume', () => {
    for (const harness of ['opencode-sdk', 'pi', 'cursor-sdk'] as const) {
      expect(getHarnessCapabilities(harness)).toEqual({
        supportsSessionResume: true,
      });
    }
  });

  test('all other harnesses do not support session resume', () => {
    const nonResumable = AGENT_HARNESSES.filter(
      (h) => h !== 'opencode-sdk' && h !== 'pi' && h !== 'cursor-sdk'
    );
    for (const harness of nonResumable) {
      expect(getHarnessCapabilities(harness)).toEqual({
        supportsSessionResume: false,
      });
    }
  });
});
