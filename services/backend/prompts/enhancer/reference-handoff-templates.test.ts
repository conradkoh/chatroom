import { describe, expect, it } from 'vitest';

import {
  renderEnhancerOutputTemplateContent,
  renderEnhancerReferencesXml,
} from './reference-handoff-templates';

const FIXTURE_CHATROOM_ID = '000000000000010002chatroom_rooms';
const FIXTURE_CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

describe('renderEnhancerOutputTemplateContent', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('contains planner output section and intro', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).toContain('Enhancer output template');
    expect(result).toContain('<references>');
  });

  it('does NOT contain builder or user reference template bodies', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).not.toContain('### Handoff to `builder`');
    expect(result).not.toContain('### Handoff to `user`');
    expect(result).not.toContain('Delegation Brief');
    expect(result).not.toContain('Report Template');
  });
});

describe('renderEnhancerReferencesXml', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('duo returns planner-to-builder and planner-to-user references', () => {
    const result = renderEnhancerReferencesXml(baseParams);

    expect(result).toContain('handoff-template for="planner->builder" team="duo"');
    expect(result).toContain('handoff-template for="planner->user" team="duo"');
    expect(result).toContain('Delegation Brief (Planner → Builder)');
    expect(result).toContain('Report Template (Planner → User)');
  });

  it('solo returns only solo-to-user reference', () => {
    const result = renderEnhancerReferencesXml({
      ...baseParams,
      teamId: 'solo',
    });

    expect(result).toContain('handoff-template for="solo->user" team="solo"');
    expect(result).not.toContain('planner->builder');
    expect(result).toContain('Report Template (Solo → User)');
  });
});
