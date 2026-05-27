/**
 * Agent entity — unit tests
 *
 * Validates the multi-shape pattern for agent harness types.
 */

import { describe, expect, test } from 'vitest';

import {
  AGENT_HARNESSES,
  AgentHarnessEnum,
  agentHarnessValidator,
  agentHarnessZodSchema,
  isAgentHarness,
  AGENT_START_REASONS,
} from './agent';

describe('AgentHarness', () => {
  test('AGENT_HARNESSES includes all seven harness types', () => {
    expect(AGENT_HARNESSES).toEqual([
      'opencode',
      'opencode-sdk',
      'pi',
      'cursor',
      'claude',
      'copilot',
      'commandcode',
    ]);
  });

  test('enum has entries for each harness', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(AgentHarnessEnum[harness]).toBe(harness);
    }
    expect(Object.keys(AgentHarnessEnum)).toHaveLength(AGENT_HARNESSES.length);
  });

  test('isAgentHarness accepts known values', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(isAgentHarness(harness)).toBe(true);
    }
  });

  test('isAgentHarness rejects unknown values', () => {
    expect(isAgentHarness('nonexistent')).toBe(false);
    expect(isAgentHarness('')).toBe(false);
  });

  test('agentHarnessValidator.members stays in sync with AGENT_HARNESSES', () => {
    const members = (agentHarnessValidator.members as readonly { value: string }[])
      .map((m) => m.value)
      .slice()
      .sort();
    const source = [...AGENT_HARNESSES].slice().sort();
    expect(members).toEqual(source);
  });

  test('agentHarnessZodSchema accepts all harness values', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(agentHarnessZodSchema.parse(harness)).toBe(harness);
    }
  });

  test('agentHarnessZodSchema rejects unknown values', () => {
    expect(() => agentHarnessZodSchema.parse('unknown-harness')).toThrow();
  });
});

describe('agent entity', () => {
  test('AGENT_START_REASONS includes "platform.crash_recovery"', () => {
    expect(AGENT_START_REASONS).toContain('platform.crash_recovery');
  });
});
