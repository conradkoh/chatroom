import { describe, expect, test } from 'vitest';

import {
  getEntryPointToUiuxEngineerHandoffTemplate,
  getGenericUiuxEngineerToEntryPointHandoffTemplate,
  getUiuxEngineerToEntryPointHandoffTemplate,
} from './uiux-engineer-handoff-templates';

describe('UI/UX engineer handoff template snapshots', () => {
  const returnTemplates = [
    getUiuxEngineerToEntryPointHandoffTemplate('planner'),
    getUiuxEngineerToEntryPointHandoffTemplate('solo'),
    getGenericUiuxEngineerToEntryPointHandoffTemplate(),
  ];

  test.each([
    ['entry point to UI/UX engineer', getEntryPointToUiuxEngineerHandoffTemplate('planner')],
    ['UI/UX engineer to planner', getUiuxEngineerToEntryPointHandoffTemplate('planner')],
    ['UI/UX engineer to solo', getUiuxEngineerToEntryPointHandoffTemplate('solo')],
    ['generic UI/UX engineer handback', getGenericUiuxEngineerToEntryPointHandoffTemplate()],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });

  test.each(returnTemplates)('makes accessibility implementation opt-in', (template) => {
    expect(template).toContain(
      'Do not propose or require web accessibility implementation work unless the user explicitly requests it.'
    );
    expect(template).not.toMatch(
      /accessibility test|accessible semantics|keyboard shortcuts|focus order/i
    );
  });
});
