import { describe, expect, test } from 'vitest';

import { appendTaskDeliveryEnhancerGuidance } from './enhancer-guidance';

describe('appendTaskDeliveryEnhancerGuidance', () => {
  test('includes enhancer context and async handoff rules', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('Handoff Enhancer (enabled)');
    expect(output).toContain('enhancer has no context');
    expect(output).toContain('asynchronously');
    expect(output).toContain('Run get-next-task immediately');
    expect(output).toContain('Do not hand off to builder again');
    expect(output).toContain('</handoff-enhancer>');
  });
});
