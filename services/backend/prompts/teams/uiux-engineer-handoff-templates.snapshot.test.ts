import { describe, expect, test } from 'vitest';

import {
  getEntryPointToUiuxEngineerHandoffTemplate,
  getGenericUiuxEngineerToEntryPointHandoffTemplate,
  getUiuxEngineerToEntryPointHandoffTemplate,
} from './uiux-engineer-handoff-templates';

describe('UI/UX engineer handoff template snapshots', () => {
  test.each([
    ['entry point to UI/UX engineer', getEntryPointToUiuxEngineerHandoffTemplate('planner')],
    ['UI/UX engineer to planner', getUiuxEngineerToEntryPointHandoffTemplate('planner')],
    ['UI/UX engineer to solo', getUiuxEngineerToEntryPointHandoffTemplate('solo')],
    ['generic UI/UX engineer handback', getGenericUiuxEngineerToEntryPointHandoffTemplate()],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });
});
