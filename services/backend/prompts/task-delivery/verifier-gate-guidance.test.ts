import { describe, expect, test } from 'vitest';

import { appendVerifierGateGuidance, shouldIncludeVerifierGate } from './verifier-gate-guidance';
import { VERIFIER_VERDICTS } from '../teams/verifier-handoff-templates';

/** Duo entry-point targets: a builder is advertised, so rework delegates. */
const TARGETS_WITH_VERIFIER = ['architect', 'verifier', 'builder', 'user'] as const;
/** Solo entry-point targets: no builder, so rework is done by the entry point. */
const SOLO_TARGETS_WITH_VERIFIER = ['architect', 'verifier', 'uiux-engineer', 'user'] as const;
const TARGETS_WITHOUT_VERIFIER = ['architect', 'builder', 'user'] as const;

describe('shouldIncludeVerifierGate', () => {
  test('includes the gate for an entry-point role with verifier advertised', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
      })
    ).toBe(true);
  });

  test('excludes the gate for a non-entry-point role', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: false,
        availableHandoffTargets: TARGETS_WITH_VERIFIER,
      })
    ).toBe(false);
  });

  test('excludes the gate when verifier is not an advertised target', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: TARGETS_WITHOUT_VERIFIER,
      })
    ).toBe(false);
  });

  test('matches the verifier target case-insensitively', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: ['Verifier'],
      })
    ).toBe(true);
  });

  test('includes the gate for a solo entry point with verifier advertised', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
        availableHandoffTargets: SOLO_TARGETS_WITH_VERIFIER,
      })
    ).toBe(true);
  });

  test('excludes the gate for a solo entry point without a verifier target', () => {
    expect(
      shouldIncludeVerifierGate({
        isEntryPoint: true,
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
    expect(output).toContain('## Verifier Gate');
    expect(output).toContain('If this task involved code changes');
    expect(output).toContain('Requested test runs');
    // The leading blank line keeps the block visually separated from neighbours.
    expect(output.startsWith('existing line\n\n<verifier-gate>')).toBe(true);
  });

  test('states the generic code-change rule with no mode restriction', () => {
    const output = renderGate();

    expect(output).toContain('If this task involved code changes');
    expect(output).not.toContain('This does not apply to Chat mode');
    expect(output).not.toContain('required in code and code:enhanced');
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

  test('step 2 tells the planner to fill the verifier review block', () => {
    const output = renderGate();

    expect(output).toContain(
      '`ACHIEVED`: deliver to `user`. In code modes, fill the "Proof of verification (verifier review)" block'
    );
    expect(output).toContain("the report's Proof of Completion");
    expect(output).toContain('the verdict message id, the verifier request command, and the round');
    expect(output).toContain(
      'In `chat` mode, add one line instead: `Verifier review: ACHIEVED (<verdict message id>)`'
    );
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
