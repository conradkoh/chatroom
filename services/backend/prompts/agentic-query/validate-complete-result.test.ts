import { describe, expect, it } from 'vitest';

import { validateAgenticQueryCompleteResult } from './validate-complete-result.js';

const VALID_BODY = `## Summary

Short answer.

## Results

- Finding one

## Grounding

- \`src/a.ts:10\` — evidence

## Files

- src/a.ts — relevant
`;

describe('validateAgenticQueryCompleteResult', () => {
  it('accepts a valid result with grounding', () => {
    const result = validateAgenticQueryCompleteResult(VALID_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain('Short answer');
      expect(result.grounding).toContain('src/a.ts');
    }
  });

  it('accepts result without grounding section', () => {
    const body = `## Summary\n\nDone.\n\n## Results\n\n- item\n\n## Files\n\n- a.ts`;
    const result = validateAgenticQueryCompleteResult(body);
    expect(result.ok).toBe(true);
  });

  it('rejects missing summary', () => {
    const result = validateAgenticQueryCompleteResult('## Results\n\nx\n\n## Files\n\ny');
    expect(result.ok).toBe(false);
  });
});
