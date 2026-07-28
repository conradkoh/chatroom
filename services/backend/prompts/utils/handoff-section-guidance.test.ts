import { describe, expect, test } from 'vitest';

import {
  HANDOFF_NOT_APPLICABLE_EXACT_TEXT,
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from './handoff-section-guidance';

describe('handoff-section-guidance', () => {
  test('HANDOFF_NOT_APPLICABLE_EXACT_TEXT is exactly "Not Applicable."', () => {
    expect(HANDOFF_NOT_APPLICABLE_EXACT_TEXT).toBe('Not Applicable.');
  });

  test('getHandoffNotApplicableSectionComment includes exact text and no-explanation rule', () => {
    const comment = getHandoffNotApplicableSectionComment('List decisions');
    expect(comment).toContain('write exactly "Not Applicable."');
    expect(comment).toContain('with no explanation');
    expect(comment).toContain('List decisions');
    expect(comment).toContain('REQUIRED');
  });

  test('getHandoffReportTemplateIntro includes global N/A callout', () => {
    const intro = getHandoffReportTemplateIntro('Report Template (Planner → User)');
    expect(intro).toContain('Not Applicable.');
    expect(intro).toContain('no explanation');
    expect(intro).toContain('no em-dash');
  });
});
