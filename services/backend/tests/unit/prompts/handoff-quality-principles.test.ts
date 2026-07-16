import { describe, expect, test } from 'vitest';

import {
  PROOF_OF_PRINCIPLES_HEADING_H2,
  PROOF_OF_PRINCIPLES_HEADING_H3,
  getHandoffQualityPrinciplesCommentBlock,
} from '../../../prompts/utils/handoff-quality-principles';

const PRINCIPLE_NAMES = [
  'Semantic Consistency',
  'Organization & Maintainability',
  'Static Evaluability and Provability',
  'No Revisit',
  'Leave It Better',
];

describe('handoff-quality-principles', () => {
  test('getHandoffQualityPrinciplesCommentBlock includes exactly 5 principles', () => {
    const block = getHandoffQualityPrinciplesCommentBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(name);
    }
    // Count principle bullet lines (not `-->` closing comment)
    const bulletLines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(bulletLines).toHaveLength(5);
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
