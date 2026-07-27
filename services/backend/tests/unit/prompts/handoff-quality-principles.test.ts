import { describe, expect, test } from 'vitest';

import {
  PROOF_OF_PRINCIPLES_HEADING_H2,
  PROOF_OF_PRINCIPLES_HEADING_H3,
  getHandoffQualityPrinciplesTemplateBlock,
} from '../../../prompts/utils/handoff-quality-principles';

const PRINCIPLE_NAMES = [
  'Semantic Consistency',
  'Organization & Maintainability',
  'Reducing Optionality',
  'Static Evaluability and Provability',
  'No Revisit',
  'Leave It Better',
];

describe('handoff-quality-principles', () => {
  test('getHandoffQualityPrinciplesTemplateBlock includes all 6 principle names as **Name:** bullets', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(`**${name}:**`);
    }
    const bulletLines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(bulletLines).toHaveLength(6);
  });

  test('each principle has its own HTML comment on the following line', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(`<!-- ${name}:`);
    }
  });

  test('each principle includes "or Not Applicable"', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    const occurrences = (block.match(/or Not Applicable/g) || []).length;
    expect(occurrences).toBe(6);
  });

  test('block is NOT wrapped in a single combined HTML comment', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    // Each principle has its own <!-- comment -->, not one big <!-- ... -->
    expect(block.startsWith('<!--')).toBe(false);
  });

  test('headings use correct markdown level', () => {
    expect(PROOF_OF_PRINCIPLES_HEADING_H2).toBe('## Proof of Principles');
    expect(PROOF_OF_PRINCIPLES_HEADING_H3).toBe('### Proof of Principles');
  });
});
