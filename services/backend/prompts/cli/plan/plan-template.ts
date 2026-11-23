/**
 * Plan template: the markdown an agent fills in and publishes with
 * `chatroom plan publish`.
 *
 * The skeleton is generated from the same constants the parser enforces
 * (`plan-template-spec.ts`), so the documented structure cannot drift from the
 * accepted grammar.
 *
 * Unlike handoff templates there is no role pair and no chat/code variant: a
 * plan has no recipient. `nativeIntegration` is accepted for parity with the
 * other template generators and does not change the text — every harness
 * publishes through the CLI.
 */

import { planPublishCommand, planReadCommand } from './command';
import {
  PLAN_HEADINGS,
  PLAN_NONE_ALLOWED_PHASE_SECTIONS,
  PLAN_NONE_ALLOWED_SECTIONS,
  PLAN_NONE_TOKEN,
  PLAN_PHASE_SEPARATOR,
  PLAN_PHASE_SECTION_NAMES,
  PLAN_REQUIRED_PHASE_SECTIONS,
  PLAN_SECTION_NAMES,
  type PlanPhaseSectionName,
  type PlanSectionName,
} from '../../../src/domain/plan/plan-template-spec';

export interface PlanTemplateParams {
  nativeIntegration?: boolean | undefined;
  cliEnvPrefix?: string | undefined;
}

function planSection(name: PlanSectionName): string {
  return `${PLAN_HEADINGS.section}${PLAN_SECTION_NAMES[name]}`;
}

function phaseSection(name: PlanPhaseSectionName): string {
  return `${PLAN_HEADINGS.phaseSection}${PLAN_PHASE_SECTION_NAMES[name]}`;
}

function phaseHeading(id: string, title: string): string {
  return `${PLAN_HEADINGS.phase}${id} ${PLAN_PHASE_SEPARATOR} ${title}`;
}

function phaseListEntry(id: string, title: string): string {
  return `- ${id} ${PLAN_PHASE_SEPARATOR} ${title}`;
}

/** Plan-level Constraints demonstrates the `None.` allowance. */
function planConstraintsLine(): string {
  return PLAN_NONE_ALLOWED_SECTIONS.includes('constraints')
    ? `- ${PLAN_NONE_TOKEN}`
    : '- <constraint>';
}

function skeletonLines(): string[] {
  const none = `- ${PLAN_NONE_TOKEN}`;
  return [
    `${PLAN_HEADINGS.title}<plan title>`,
    '',
    planSection('sources'),
    '- <user request message id, specialist design ids, and the work package id>',
    '',
    planSection('requirements'),
    '- <requirement>',
    '',
    planSection('constraints'),
    planConstraintsLine(),
    '',
    planSection('phases'),
    phaseListEntry('P1', '<phase 1 title>'),
    phaseListEntry('P2', '<phase 2 title>'),
    '',
    planSection('phaseDetails'),
    '',
    phaseHeading('P1', '<phase 1 title>'),
    '',
    phaseSection('dependsOn'),
    none,
    '',
    phaseSection('requirements'),
    '- <what this phase delivers>',
    '',
    // Per-phase Constraints may render `- None.` (PLAN_NONE_ALLOWED_PHASE_SECTIONS).
    phaseSection('constraints'),
    none,
    '',
    phaseSection('acceptance'),
    '- <observable done-condition, including one end-to-end check>',
    '',
    phaseHeading('P2', '<phase 2 title>'),
    '',
    phaseSection('dependsOn'),
    '- P1',
    '',
    phaseSection('requirements'),
    '- <what this phase delivers>',
    '',
    phaseSection('constraints'),
    '- <phase 2 constraint>',
    '',
    phaseSection('acceptance'),
    '- <observable done-condition, including one end-to-end check>',
    '',
    planSection('remarks'),
    '<optional: revisions and which delegated phases are unchanged, replaced, or dropped — omit this section when empty>',
  ];
}

function noneAllowedSummary(): string {
  return [
    ...PLAN_NONE_ALLOWED_SECTIONS.map((name) => PLAN_SECTION_NAMES[name]),
    ...PLAN_NONE_ALLOWED_PHASE_SECTIONS.map((name) => `phase ${PLAN_PHASE_SECTION_NAMES[name]}`),
  ].join(', ');
}

function requiredPhaseSectionsSummary(): string {
  return PLAN_REQUIRED_PHASE_SECTIONS.map((name) => PLAN_PHASE_SECTION_NAMES[name]).join(', ');
}

export function getPlanTemplate(params: PlanTemplateParams = {}): string {
  const cliEnvPrefix = params.cliEnvPrefix ?? '';

  return [
    'Instructions (not part of the message): fill in every <placeholder> and keep the heading order below.',
    'Publish the fenced markdown as the plan body with:',
    '',
    planPublishCommand({ cliEnvPrefix }),
    '',
    'Read the whole plan back with:',
    planReadCommand({ cliEnvPrefix }),
    '',
    'Read one phase back with:',
    planReadCommand({ cliEnvPrefix, phase: 'P2' }),
    '',
    `Every phase needs ${requiredPhaseSectionsSummary()}. "${PLAN_NONE_TOKEN}" is allowed only for: ${noneAllowedSummary()}.`,
    'Phases are referenced as <planId>#Pn — report the plan id the publish command returns.',
    '',
    '```markdown',
    ...skeletonLines(),
    '```',
  ].join('\n');
}
