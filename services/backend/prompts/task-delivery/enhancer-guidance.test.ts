import { describe, expect, test } from 'vitest';

import {
  appendTaskDeliveryEnhancerGuidance,
  appendTaskDeliveryEnhancerReviewGuidance,
} from './enhancer-guidance';

describe('appendTaskDeliveryEnhancerGuidance', () => {
  test('includes enhancer context and async handoff rules', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('You MUST check in with the enhancer');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).toContain('enhancer has no context');
    expect(output).toContain('asynchronously');
    expect(output).toContain('Run get-next-task immediately');
    expect(output).toContain('Do not hand off to enhancer again');
    expect(output).toContain('</handoff-enhancer>');
  });
});

describe('appendTaskDeliveryEnhancerReviewGuidance', () => {
  test('includes review and builder handoff instructions', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerReviewGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<enhancer-review>');
    expect(output).toContain('Enhancer Planning Feedback');
    expect(output).toContain('delegate to `builder`');
    expect(output).toContain('</enhancer-review>');
  });
});
