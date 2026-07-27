import { describe, expect, test } from 'vitest';

import { getHandoffReportTemplateBody } from './handoff-report-template-body';

describe('getHandoffReportTemplateBody', () => {
  test('contains handoff-proofs wrapper', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('<handoff-proofs>');
    expect(body).toContain('</handoff-proofs>');
  });

  test('contains handoff-details wrapper', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('<handoff-details>');
    expect(body).toContain('</handoff-details>');
  });

  test('has Summary outside proofs block', () => {
    const body = getHandoffReportTemplateBody();
    const summaryIdx = body.indexOf('## Summary');
    const proofsIdx = body.indexOf('<handoff-proofs>');
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(proofsIdx).toBeGreaterThan(summaryIdx);
  });

  test('contains all expected sections', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('## What changed');
    expect(body).toContain('Proof of Completion');
    expect(body).toContain('Code Change Verification');
    expect(body).toContain('## Notes');
  });
});
