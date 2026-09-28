import { describe, expect, test } from 'vitest';

import {
  getArchitectToEntryPointHandoffTemplate,
  getEntryPointToArchitectHandoffTemplate,
  getGenericArchitectToEntryPointHandoffTemplate,
} from './architect-handoff-templates';

describe('architect handoff template snapshots', () => {
  test.each([
    ['entry point to architect', getEntryPointToArchitectHandoffTemplate('planner')],
    ['architect to planner', getArchitectToEntryPointHandoffTemplate('planner')],
    ['architect to solo', getArchitectToEntryPointHandoffTemplate('solo')],
    ['generic architect handback', getGenericArchitectToEntryPointHandoffTemplate()],
  ] as const)('%s renders the complete contract', (_variant, template) => {
    expect(template).toMatchSnapshot();
  });
});
