import { describe, expect, test } from 'vitest';

import { getHandoffSeverityGuidanceBlock } from './handoff-severity-guidance';

describe('getHandoffSeverityGuidanceBlock', () => {
  test('mentions all three severity tiers', () => {
    const block = getHandoffSeverityGuidanceBlock();
    expect(block).toContain('[high]');
    expect(block).toContain('[medium]');
    expect(block).toContain('[low]');
  });

  test('is wrapped in HTML comments', () => {
    const block = getHandoffSeverityGuidanceBlock();
    expect(block).toContain('<!--');
    expect(block).toContain('-->');
  });
});
