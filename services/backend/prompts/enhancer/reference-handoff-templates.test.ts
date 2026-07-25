import { describe, expect, it } from 'vitest';

import { renderEnhancerReferenceHandoffTemplatesContent } from './reference-handoff-templates';
import {
  HANDOFF_TEMPLATE_FIXTURE_CHATROOM_ID,
  HANDOFF_TEMPLATE_FIXTURE_CLI_ENV_PREFIX,
} from '../../tests/helpers/handoff-template-fixtures';

describe('renderEnhancerReferenceHandoffTemplatesContent', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: HANDOFF_TEMPLATE_FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: HANDOFF_TEMPLATE_FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('wraps templates in handoff-templates with output and planner references', () => {
    const result = renderEnhancerReferenceHandoffTemplatesContent(baseParams);

    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).toContain('Enhancer output template');
    expect(result).toContain('### Handoff to `builder` (planner reference)');
    expect(result).toContain('Delegation Brief (Planner → Builder)');
    expect(result).toContain('### Handoff to `user` (planner reference)');
    expect(result).toContain('Report Template (Planner → User)');
  });

  it('omits planner reference templates when team has no match', () => {
    const result = renderEnhancerReferenceHandoffTemplatesContent({
      ...baseParams,
      teamId: 'solo',
    });

    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).not.toContain('### Handoff to `builder`');
    expect(result).toContain('### Handoff to `user` (planner reference)');
    expect(result).toContain('Report Template (Solo → User)');
  });
});
