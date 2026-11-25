/**
 * Drift test: the printed grounding skeleton must always validate, and the
 * validator must reject any structural change to it. Literal expectations, not
 * re-derived from the generator, so a spec rename cannot silently pass.
 */

import { describe, expect, test } from 'vitest';

import { getGroundingSkeleton } from './grounding-template';
import { viewGroundingTemplate } from './view-template';
import { validateGrounding } from '../../../src/domain/grounding/validate-grounding';

const HEADINGS = [
  '## Request',
  '## Relevant files',
  '## Entry points',
  '## Flow',
  '## Prior records',
  '## Not inspected',
] as const;

/** The template is a fill-in form: `<…>` marks every slot. */
function fill(skeleton: string): string {
  return skeleton.replace(/<[^>]*>/g, 'filled');
}

describe('grounding skeleton', () => {
  test('validates once every placeholder is filled', () => {
    expect(validateGrounding(fill(getGroundingSkeleton()))).toEqual({ ok: true });
  });

  test('contains exactly the six spec headings, in order', () => {
    const lines = getGroundingSkeleton().split('\n');
    const headings = lines.filter((line) => line.startsWith('## '));
    expect(headings).toEqual([...HEADINGS]);
  });

  test('keeps the mermaid flow block inside the skeleton', () => {
    const filled = fill(getGroundingSkeleton());
    expect(filled).toContain('```mermaid');
    expect(validateGrounding(filled).ok).toBe(true);
  });

  test.each(HEADINGS)('fails with GROUNDING_SECTION_MISSING when %s is removed', (heading) => {
    const withoutSection = getGroundingSkeleton()
      .split('\n')
      .filter((line) => line !== heading)
      .join('\n');

    const result = validateGrounding(fill(withoutSection));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('GROUNDING_SECTION_MISSING');
    }
  });

  test('fails with GROUNDING_SECTION_ORDER when two headings are swapped', () => {
    const lines = getGroundingSkeleton().split('\n');
    const first = lines.indexOf('## Request');
    const second = lines.indexOf('## Relevant files');
    [lines[first], lines[second]] = [lines[second] as string, lines[first] as string];

    const result = validateGrounding(fill(lines.join('\n')));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('GROUNDING_SECTION_ORDER');
    }
  });
});

describe('viewGroundingTemplate', () => {
  test('prints the skeleton, a blank line, then the rules', () => {
    const output = viewGroundingTemplate();

    expect(output.startsWith(getGroundingSkeleton())).toBe(true);
    expect(output.slice(getGroundingSkeleton().length)).toMatch(/^\n\nRules for this document:/);
  });
});
