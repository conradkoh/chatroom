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

  test('handoff-overview contains Summary and What changed', () => {
    const body = getHandoffReportTemplateBody();
    const overview = body.match(/<handoff-overview>[\s\S]*<\/handoff-overview>/)?.[0] ?? '';
    expect(overview).toContain('## Summary');
    expect(overview).toContain('## What changed');
    expect(overview).not.toContain('## What exists today');
  });

  test('handoff-direction contains What exists today', () => {
    const body = getHandoffReportTemplateBody();
    const direction = body.match(/<handoff-direction>[\s\S]*<\/handoff-direction>/)?.[0] ?? '';
    expect(direction).toContain('## What exists today');
    expect(direction).toContain('## Key Technical Decisions');
  });

  test('handoff-action contains Manual steps', () => {
    const body = getHandoffReportTemplateBody();
    const action = body.match(/<handoff-action>[\s\S]*<\/handoff-action>/)?.[0] ?? '';
    expect(action).toContain('## Manual steps');
  });

  test('handoff-action contains severity guidance for tech debt', () => {
    const body = getHandoffReportTemplateBody();
    const action = body.match(/<handoff-action>[\s\S]*<\/handoff-action>/)?.[0] ?? '';
    expect(action).toContain('[high]');
    expect(action).toContain('[medium]');
    expect(action).toContain('[low]');
  });

  test('handoff-proofs contains ## Proof of Principles (not ###)', () => {
    const body = getHandoffReportTemplateBody();
    const proofs = body.match(/<handoff-proofs>[\s\S]*<\/handoff-proofs>/)?.[0] ?? '';
    expect(proofs).toContain('## Proof of Principles');
    expect(proofs).not.toContain('### Proof of Principles');
    expect(proofs).not.toContain('## What changed');
  });

  test('contains structured principles with per-principle bullets inside proofs', () => {
    const body = getHandoffReportTemplateBody();
    const proofs = body.match(/<handoff-proofs>[\s\S]*<\/handoff-proofs>/)?.[0] ?? '';
    expect(proofs).toContain('**Semantic Consistency:**');
    expect(proofs).toContain('**No Revisit:**');
    expect(proofs).toContain('exactly "Not Applicable."');
  });

  test('section comments require exact Not Applicable. with no explanation', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('write exactly "Not Applicable." with no explanation');
  });

  test('no longer has old combined comment block', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).not.toContain('<!-- Demonstrate adherence to:');
  });

  test('Proof of Completion is ## in proofs', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('## Proof of Completion');
  });

  test('contains all expected proof sections', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).toContain('Code Change Verification');
    expect(body).toContain('Backlog Tasks Implemented');
  });

  test('no longer has old omit-if-none or <Omit placeholders', () => {
    const body = getHandoffReportTemplateBody();
    expect(body).not.toMatch(/<Omit/i);
    expect(body).not.toMatch(/Omit if none/i);
    expect(body).not.toMatch(/Omit for trivial/i);
    expect(body).not.toMatch(/Omit this section when/i);
  });

  test('contains REQUIRED comments for each section', () => {
    const body = getHandoffReportTemplateBody();
    const requiredCount = (body.match(/<!-- REQUIRED\./g) || []).length;
    expect(requiredCount).toBeGreaterThanOrEqual(9);
  });

  test('Proof of Principles includes REQUIRED mandatory comment in proofs', () => {
    const body = getHandoffReportTemplateBody();
    const proofs = body.match(/<handoff-proofs>[\s\S]*<\/handoff-proofs>/)?.[0] ?? '';
    expect(proofs).toContain('REQUIRED: Complete every principle below');
  });
});
