import { describe, expect, test } from 'vitest';

import {
  PROOF_OF_PRINCIPLES_HEADING_H2,
  PROOF_OF_PRINCIPLES_HEADING_H3,
  PROOF_OF_PRINCIPLES_MANDATORY_COMMENT,
  getHandoffQualityPrinciplesSectionBlock,
  getHandoffQualityPrinciplesTemplateBlock,
} from '../../../prompts/utils/handoff-quality-principles';

const PRINCIPLE_NAMES = [
  'Semantic Consistency',
  'Organization & Maintainability',
  'Reducing Optionality',
  'Static Evaluability and Provability',
  'No Revisit',
  'Leave It Better',
  'Documented Constraints',
];

describe('handoff-quality-principles', () => {
  test('getHandoffQualityPrinciplesTemplateBlock includes all 7 principle names as **Name:** bullets', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(`**${name}:**`);
    }
    const bulletLines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(bulletLines).toHaveLength(7);
  });

  test('each principle has its own HTML comment on the following line', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(`<!-- ${name}:`);
    }
  });

  test('each principle includes exactly "Not Applicable." placeholder', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    const occurrences = (block.match(/exactly "Not Applicable\."/g) || []).length;
    expect(occurrences).toBe(7);
  });

  test('block is NOT wrapped in a single combined HTML comment', () => {
    const block = getHandoffQualityPrinciplesTemplateBlock();
    // Each principle has its own <!-- comment -->, not one big <!-- ... -->
    expect(block.startsWith('<!--')).toBe(false);
  });

  test('PROOF_OF_PRINCIPLES_MANDATORY_COMMENT contains REQUIRED and exact Not Applicable. guidance', () => {
    expect(PROOF_OF_PRINCIPLES_MANDATORY_COMMENT).toContain('REQUIRED');
    expect(PROOF_OF_PRINCIPLES_MANDATORY_COMMENT).toContain('Not Applicable.');
    expect(PROOF_OF_PRINCIPLES_MANDATORY_COMMENT).toContain('with no explanation');
    expect(PROOF_OF_PRINCIPLES_MANDATORY_COMMENT).toContain('do not omit');
  });

  test('getHandoffQualityPrinciplesSectionBlock includes mandatory comment and all 7 principles', () => {
    const block = getHandoffQualityPrinciplesSectionBlock();
    expect(block).toContain(PROOF_OF_PRINCIPLES_MANDATORY_COMMENT);
    expect(block).toContain('## Proof of Principles');
    for (const name of PRINCIPLE_NAMES) {
      expect(block).toContain(`**${name}:**`);
    }
  });

  test('headings use correct markdown level', () => {
    expect(PROOF_OF_PRINCIPLES_HEADING_H2).toBe('## Proof of Principles');
    expect(PROOF_OF_PRINCIPLES_HEADING_H3).toBe('### Proof of Principles');
  });
});
