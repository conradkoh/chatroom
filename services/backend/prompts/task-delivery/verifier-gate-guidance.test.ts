import { describe, expect, test } from 'vitest';

import { appendVerifierGateGuidance, shouldIncludeVerifierGate } from './verifier-gate-guidance';
import { VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

const TARGETS_WITH_VERIFIER = ['architect', 'verifier', 'builder', 'user'] as const;
const TARGETS_WITHOUT_VERIFIER = ['architect', 'builder', 'user'] as const;

describe('shouldIncludeVerifierGate', () => {
  test.each([
    ['code mode', { conversationMode: 'code' as const }],
    ['code:enhanced mode', { conversationMode: 'code:enhanced' as const }],
    ['legacy undefined mode', { conversationMode: undefined }],
  ])('includes the gate for an entry-point planner in %s', (_label, overrides) => {
    expect(
      shouldIncludeVerifierGate({
        role: 'planner',
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
        ...overrides,
      })
    ).toBe(true);
  });

  test.each([
    ['chat mode', { conversationMode: 'chat' as const }],
    ['the builder role', { role: 'builder', conversationMode: 'code' as const }],
    ['the architect role', { role: 'architect', conversationMode: 'code' as const }],
    ['the verifier role', { role: 'verifier', conversationMode: 'code' as const }],
    ['a non-entry-point planner', { isEntryPoint: false, conversationMode: 'code' as const }],
  ])('excludes the gate for %s', (_label, overrides) => {
    expect(
      shouldIncludeVerifierGate({
        role: 'planner',
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
        ...overrides,
      })
    ).toBe(false);
  });

  test('excludes the gate when verifier is not an advertised target', () => {
    expect(
      shouldIncludeVerifierGate({
        role: 'planner',
        isEntryPoint: true,
        conversationMode: 'code',
        availableHandoffTargets: TARGETS_WITHOUT_VERIFIER,
      })
    ).toBe(false);
  });

  test('matches the verifier target case-insensitively', () => {
    expect(
      shouldIncludeVerifierGate({
        role: 'planner',
        isEntryPoint: true,
        conversationMode: 'code',
        availableHandoffTargets: ['Verifier'],
      })
    ).toBe(true);
  });
});

describe('appendVerifierGateGuidance', () => {
  function renderGate(): string {
    const lines: string[] = ['existing line'];
    appendVerifierGateGuidance(lines);
    return lines.join('\n');
  }

  test('renders the gate block wrapping its sections', () => {
    const output = renderGate();

    expect(output).toContain('<verifier-gate>');
    expect(output).toContain('</verifier-gate>');
    expect(output).toContain('## Verifier Gate (required in code and code:enhanced modes)');
    // The leading blank line keeps the block visually separated from neighbours.
    expect(output.startsWith('existing line\n\n<verifier-gate>')).toBe(true);
  });

  test('names every verdict token from VERIFIER_VERDICTS', () => {
    const output = renderGate();

    for (const verdict of VERIFIER_VERDICTS) {
      expect(output).toContain(`\`${verdict}\``);
    }
  });

  test('states the round cap', () => {
    const output = renderGate();

    expect(output).toContain('Maximum 2 verification rounds per user message');
    expect(output).toContain('After round 2, deliver');
  });

  test('states the chat exemption', () => {
    expect(renderGate()).toContain('This does not apply to Chat mode');
  });

  test('states the stale-verdict rule', () => {
    expect(renderGate()).toContain(
      "Ignore a verdict whose user message id is not the user's current last message"
    );
  });

  test('states the UNAVAILABLE delivery rule', () => {
    expect(renderGate()).toContain('Verifier review: UNAVAILABLE (<reason>)');
  });
});
