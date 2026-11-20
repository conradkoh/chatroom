import { describe, expect, test } from 'vitest';

import { codeReviewSkill } from './index';

describe('code-review skill readability pillar', () => {
  test('lists eleven pillars and includes Pillar 11 for readability and comments', () => {
    const prompt = codeReviewSkill.getPrompt('');

    expect(codeReviewSkill.description).toContain('eleven pillars');
    expect(codeReviewSkill.description).toContain('readability and comments');
    expect(prompt).toContain('Apply the eleven pillars below in priority order.');
    expect(prompt).toContain('## Pillar 11 — Readability & Comments (Standard Priority)');
  });
});
