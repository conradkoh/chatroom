import { describe, expect, test } from 'vitest';

import { parsePlan } from '../../../src/domain/plan/parse-plan';
import {
  PLAN_HEADINGS,
  PLAN_PHASE_SECTION_NAMES,
  PLAN_SECTION_NAMES,
} from '../../../src/domain/plan/plan-template-spec';
import { findReservedDelimiterLines } from '../stdin-heredoc';
import { getPlanTemplate } from './plan-template';

/** The part an agent pastes into the heredoc: between ```markdown and the final fence. */
function skeleton(template: string): string {
  const open = template.indexOf('```markdown');
  const close = template.lastIndexOf('```');
  return template.slice(open + '```markdown'.length, close).trim();
}

describe('getPlanTemplate', () => {
  test('the skeleton parses with parsePlan once placeholders are filled', () => {
    const filled = skeleton(getPlanTemplate({})).replace(/<[^>\n]+>/g, 'Sample');
    const result = parsePlan(filled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.title).toBe('Sample');
      expect(result.plan.phases.map((phase) => phase.id)).toEqual(['P1', 'P2']);
    }
  });

  test('contains every plan section and phase sub-section from the spec', () => {
    const body = skeleton(getPlanTemplate({}));
    for (const name of Object.values(PLAN_SECTION_NAMES)) {
      expect(body).toContain(`${PLAN_HEADINGS.section}${name}`);
    }
    for (const name of Object.values(PLAN_PHASE_SECTION_NAMES)) {
      expect(body).toContain(`${PLAN_HEADINGS.phaseSection}${name}`);
    }
  });

  test('per-phase Constraints may render - None.', () => {
    expect(skeleton(getPlanTemplate({}))).toContain(`#### Constraints\n- None.`);
  });

  test('the pasteable skeleton has no reserved heredoc delimiter lines', () => {
    expect(findReservedDelimiterLines(skeleton(getPlanTemplate({})))).toEqual([]);
  });

  test('names the publish command, the read commands and the citation token', () => {
    const template = getPlanTemplate({ cliEnvPrefix: '' });
    expect(template).toContain('chatroom plan publish');
    expect(template).toContain('chatroom plan read');
    expect(template).toContain('<planId>#Pn');
  });

  test('nativeIntegration does not change the template', () => {
    expect(getPlanTemplate({ nativeIntegration: true })).toBe(
      getPlanTemplate({ nativeIntegration: false })
    );
  });

  test('the Sources placeholder and phase instruction match the coordinator workflow', () => {
    const template = getPlanTemplate({});
    expect(template).toContain(
      '- <user request message id and the specialist brief ids this plan builds on>'
    );
    expect(template).toContain(
      'Each phase is one deliverable the coordinator can place in a work package; a phase is not a builder pass.'
    );
  });
});
