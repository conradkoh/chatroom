import { describe, expect, it } from 'vitest';

import { renderEnhancerReferenceHandoffTemplatesContent } from './reference-handoff-templates';

const FIXTURE_CHATROOM_ID = '000000000000010002chatroom_rooms';
const FIXTURE_CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

describe('renderEnhancerReferenceHandoffTemplatesContent', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
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
