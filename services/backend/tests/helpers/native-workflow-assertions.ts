/**
 * Readable assertions for native init vs delivery disclosure.
 */

import { expect } from 'vitest';

import type { NativeDeliveryScenario } from './native-workflow-fixtures';
import { NATIVE_DELIVERY_SECTION_ORDER, indexOfSectionLine } from './native-workflow-fixtures';

/** Native delivery sections appear in this order (agents read top-to-bottom). */
export function assertNativeDeliverySectionOrder(output: string): void {
  let lastIndex = -1;
  for (const marker of NATIVE_DELIVERY_SECTION_ORDER) {
    const index = indexOfSectionLine(output, marker);
    expect(index, `missing section marker ${marker}`).toBeGreaterThanOrEqual(0);
    expect(index, `section ${marker} is out of order`).toBeGreaterThan(lastIndex);
    lastIndex = index;
  }
}

/** Step 2 in <next-steps> targets the task sender (primary return path). */
export function assertNativePrimaryHandoffInNextSteps(
  output: string,
  primaryTarget: string,
  senderRole?: string
): void {
  const start = output.indexOf('<next-steps>');
  const end = output.indexOf('</next-steps>');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const nextSteps = output.slice(start, end);
  expect(nextSteps).toContain('1. Work on the task above.');
  expect(nextSteps).toContain('you MUST run the handoff command');
  expect(nextSteps).toContain(`delivers it to \`${primaryTarget}\``);
  expect(nextSteps).toContain(`--next-role="${primaryTarget}"`);
  expect(nextSteps).toContain('Do not end your turn without running handoff');

  if (senderRole) {
    expect(nextSteps).toContain(`task from \`${senderRole}\``);
  }
}

export function assertNativeEagerHandoffTemplates(output: string, headings: string[]): void {
  expect(output).toContain('<handoff-templates>');
  expect(output).toContain('Use these structures when handing off.');
  for (const heading of headings) {
    expect(output, `missing eager template: ${heading}`).toContain(heading);
  }
  expect(output).not.toContain('handoff view-template');
}

export function assertNativeAlternateHandoffTargets(output: string, targets: string[]): void {
  expect(output).toContain('<handoffs>');
  expect(output).toContain('Other handoff targets (if you need a different recipient than step 2)');
  for (const target of targets) {
    expect(output).toContain(`**${target}**`);
    expect(output).toContain(`--next-role="${target}"`);
  }
}

/** Full native delivery disclosure for one scenario row from native-workflow-fixtures. */
export function assertNativeDeliveryScenario(
  output: string,
  scenario: NativeDeliveryScenario,
  options?: {
    /** When fewer roles are online than the matrix assumes (integration tests). */
    alternateHandoffTargets?: string[];
  }
): void {
  assertNativeDeliverySectionOrder(output);
  assertNativePrimaryHandoffInNextSteps(output, scenario.primaryHandoffTarget, scenario.senderRole);
  assertNativeEagerHandoffTemplates(output, scenario.eagerTemplateHeadings);
  assertNativeAlternateHandoffTargets(
    output,
    options?.alternateHandoffTargets ?? scenario.availableHandoffTargets
  );

  if (scenario.userVerificationInNextSteps) {
    const start = output.indexOf('<next-steps>');
    const end = output.indexOf('</next-steps>');
    const nextSteps = output.slice(start, end);
    expect(nextSteps).toContain('pnpm typecheck && pnpm test');
  }
}

/** Init prompt: templates are NOT eager — delivery inlines them per task. */
export function assertNativeInitTemplateDisclosure(
  prompt: string,
  options: { referencesDeliveryTemplates?: boolean } = {}
): void {
  expect(prompt).not.toContain('Begin With the End in Mind');
  expect(prompt).not.toContain('handoff view-template');
  expect(prompt).not.toContain('Report Template (Planner → User)');

  if (options.referencesDeliveryTemplates) {
    expect(prompt).toContain('task delivery');
  }
}
