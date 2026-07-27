import { describe, expect, test } from 'vitest';

import {
  appendTaskDeliveryEnhancerGuidance,
  appendTaskDeliveryEnhancerReviewGuidance,
} from './enhancer-guidance';
import {
  ENHANCER_DELEGATION_ROUND_WORKFLOW,
  ENHANCER_ENABLED_USER_WORKFLOW,
} from '../../src/domain/usecase/enhancer/enhancer-workflow';

describe('appendTaskDeliveryEnhancerGuidance', () => {
  test('includes per-delegation enhancer context and async handoff rules', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('One check-in per builder delegation');
    expect(output).toContain('Multi-slice tasks');
    expect(output).toContain('planner → enhancer → planner → builder');
    expect(output).toContain('You MUST check in with the enhancer');
    expect(output).toContain('<user-message>');
    expect(output).toContain('<grounding>');
    expect(output).toContain('<builder-handoff>');
    expect(output).toContain('enhancer has no context');
    expect(output).toContain('asynchronously');
    expect(output).toContain('Run get-next-task immediately');
    expect(output).toContain('Do not hand off to enhancer again');
    expect(output).toContain('Do not hand off to builder or user');
    expect(output).not.toContain('one check-in per user instruction');
    expect(output).toContain('</handoff-enhancer>');
    expect(output).toContain(
      'user → [loop planner → enhancer → planner → builder → planner] → user'
    );
    expect(output).toContain('Next slice');
    expect(output).toContain('Same-slice rework');
    expect(output).not.toContain('strictly linear');
  });

  test('emits SSOT workflow constants verbatim', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');
    expect(output).toContain(ENHANCER_ENABLED_USER_WORKFLOW);
    expect(output).toContain(ENHANCER_DELEGATION_ROUND_WORKFLOW);
  });
});

describe('appendTaskDeliveryEnhancerReviewGuidance', () => {
  test('includes review and builder handoff instructions', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerReviewGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<enhancer-review>');
    expect(output).toContain('Enhancer Planning Feedback');
    expect(output).toContain('Do not run `context new`');
    expect(output).toContain('already delegated to builder');
    expect(output).toContain('delegate to `builder`');
    expect(output).toContain('advisory');
    expect(output).toContain('final call');
    expect(output).toContain('One round only');
    expect(output).toContain('</enhancer-review>');
  });
});
