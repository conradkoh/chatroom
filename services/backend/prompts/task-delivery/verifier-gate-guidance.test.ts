import { describe, expect, test } from 'vitest';

import { appendVerifierGateGuidance, shouldIncludeVerifierGate } from './verifier-gate-guidance';
import { VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

/** Duo entry-point targets: a builder is advertised, so rework delegates. */
const TARGETS_WITH_VERIFIER = ['architect', 'verifier', 'builder', 'user'] as const;
/** Solo entry-point targets: no builder, so rework is done by the entry point. */
const SOLO_TARGETS_WITH_VERIFIER = ['architect', 'verifier', 'uiux-engineer', 'user'] as const;
const TARGETS_WITHOUT_VERIFIER = ['architect', 'builder', 'user'] as const;

describe('shouldIncludeVerifierGate', () => {
  test.each([
    ['code mode', { conversationMode: 'code' as const }],
    ['code:enhanced mode', { conversationMode: 'code:enhanced' as const }],
    ['legacy undefined mode', { conversationMode: undefined }],
  ])('includes the gate for an entry-point role in %s', (_label, overrides) => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
        ...overrides,
      })
    ).toBe(true);
  });

  test.each([
    ['chat mode', { conversationMode: 'chat' as const }],
    ['a non-entry-point role', { isEntryPoint: false, conversationMode: 'code' as const }],
  ])('excludes the gate for %s', (_label, overrides) => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
        ...overrides,
      })
    ).toBe(false);
  });

  test('excludes the gate when verifier is not an advertised target', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        conversationMode: 'code',
        availableHandoffTargets: TARGETS_WITHOUT_VERIFIER,
      })
    ).toBe(false);
  });

  test('matches the verifier target case-insensitively', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        conversationMode: 'code',
        availableHandoffTargets: ['Verifier'],
      })
    ).toBe(true);
  });

  test.each([['code' as const], ['code:enhanced' as const]])(
    'includes the gate for a solo entry point in %s',
    (conversationMode) => {
      expect(
        shouldIncludeVerifierGate({
          isEntryPoint: true,
          conversationMode,
          availableHandoffTargets: SOLO_TARGETS_WITH_VERIFIER,
        })
      ).toBe(true);
    }
  );

  test('excludes the gate for a solo entry point in chat mode', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        conversationMode: 'chat',
        availableHandoffTargets: SOLO_TARGETS_WITH_VERIFIER,
      })
    ).toBe(false);
  });

  test('excludes the gate for a solo entry point without a verifier target', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        conversationMode: 'code',
        availableHandoffTargets: ['architect', 'uiux-engineer', 'user'],
      })
    ).toBe(false);
  });
});

describe('appendVerifierGateGuidance', () => {
  function renderGate(hasBuilder = true): string {
    const lines: string[] = ['existing line'];
    appendVerifierGateGuidance(lines, { hasBuilder });
    return lines.join('\n');
  }

  test('renders the gate block wrapping its sections', () => {
    const output = renderGate();

    expect(output).toContain('<verifier-gate>');
    expect(output).toContain('</verifier-gate>');
    expect(output).toContain('## Verifier Gate (required in code and code:enhanced modes)');
    expect(output).toContain('Requested test runs');
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

  test('delegates rework to the builder when a builder is advertised', () => {
    const output = renderGate(true);

    expect(output).toContain('delegate to `builder`, then request round 2');
    expect(output).not.toContain('do it yourself');
    expect(output).toContain('get the missing evidence from `builder` once');
  });

  test('does the rework and evidence gathering itself when no builder is advertised', () => {
    const output = renderGate(false);

    expect(output).toContain('do it yourself, then request round 2');
    expect(output).not.toContain('delegate to `builder`');
    expect(output).toContain('gather the missing evidence yourself once');
    expect(output).not.toContain('from `builder`');
  });
});
