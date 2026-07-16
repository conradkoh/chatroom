import { describe, expect, test } from 'vitest';

import {
  PROOF_OF_PRINCIPLES_HEADING_H2,
  PROOF_OF_PRINCIPLES_HEADING_H3,
  getHandoffQualityPrinciplesCommentBlock,
} from '../../../prompts/utils/handoff-quality-principles';

const PRINCIPLE_NAMES = [
  'Organization & Maintainability',
  'Static Evaluability and Provability',
  'No Revisit',
  'Leave It Better',
];

describe('handoff-quality-principles', () => {
  test('getHandoffQualityPrinciplesCommentBlock includes exactly 4 principles', () => {
    const block = getHandoffQualityPrinciplesCommentBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(name);
    }
    // Count bullet lines (one per principle)
    const bullets = block.match(/- /g);
    expect(bullets).toHaveLength(4);
  });

  test('getHandoffQualityPrinciplesCommentBlock is an HTML comment', () => {
    const block = getHandoffQualityPrinciplesCommentBlock();
    expect(block.startsWith('<!--')).toBe(true);
    expect(block.endsWith('-->')).toBe(true);
  });

  test('headings use correct markdown level', () => {
    expect(PROOF_OF_PRINCIPLES_HEADING_H2).toBe('## Proof of Principles');
    expect(PROOF_OF_PRINCIPLES_HEADING_H3).toBe('### Proof of Principles');
  });
});
