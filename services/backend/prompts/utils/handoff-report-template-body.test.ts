import { describe, expect, test } from 'vitest';

import { getHandoffReportTemplateBody } from './handoff-report-template-body';

describe('getHandoffReportTemplateBody', () => {
  test('contains all 5 XML wrappers', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('<handoff-overview>');
    expect(body).toContain('</handoff-overview>');
    expect(body).toContain('<handoff-proofs>');
    expect(body).toContain('</handoff-proofs>');
    expect(body).toContain('<handoff-direction>');
    expect(body).toContain('</handoff-direction>');
    expect(body).toContain('<handoff-notes>');
    expect(body).toContain('</handoff-notes>');
    expect(body).toContain('<handoff-action>');
    expect(body).toContain('</handoff-action>');
  });

  test('handoff-overview contains Summary and What exists today', () => {
    const body = getHandoffReportTemplateBody();
    const overview = body.match(/<handoff-overview>[\s\S]*<\/handoff-overview>/)?.[0] ?? '';
    expect(overview).toContain('## Summary');
    expect(overview).toContain('## What exists today');
  });

  test('handoff-action contains Manual steps', () => {
    const body = getHandoffReportTemplateBody();
    const action = body.match(/<handoff-action>[\s\S]*<\/handoff-action>/)?.[0] ?? '';
    expect(action).toContain('## Manual steps');
  });

  test('no handoff-details wrapper', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).not.toContain('<handoff-details>');
  });

  test('contains all expected proof sections', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('## What changed');
    expect(body).toContain('Proof of Completion');
    expect(body).toContain('Code Change Verification');
  });
});
