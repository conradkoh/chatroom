/**
 * handoff view-template — optional CLI recovery command (not used on native delivery).
 *
 * Native delivery inlines templates eagerly; view-template remains for manual
 * reload. See native-workflow-disclosure.test.ts for delivery behavior.
 */

import { describe, expect, test } from 'vitest';

import { viewHandoffTemplate } from '../../../prompts/cli/handoff/view-template';

describe('handoff view-template command (recovery / CLI)', () => {
  test('resolves duo planner → user report template body', () => {
    const template = viewHandoffTemplate({
      role: 'planner',
      nextRole: 'user',
      teamId: 'duo',
    });
    expect(template).toContain('Report Template (Planner → User)');
  });

  test('resolves duo builder → planner handoff template body', () => {
    const template = viewHandoffTemplate({
      role: 'builder',
      nextRole: 'planner',
      teamId: 'duo',
    });
    expect(template).toContain('Handoff Template (Builder → Planner)');
  });
});
