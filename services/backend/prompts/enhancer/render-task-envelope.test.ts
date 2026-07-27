import { describe, expect, it } from 'vitest';

import { renderEnhancerTaskEnvelope } from './render-task-envelope';

describe('renderEnhancerTaskEnvelope', () => {
  const params = {
    jobId: 'job-123',
    chatroomId: 'room-abc',
    targetId: 'handoff:planner-to-builder' as const,
    outputTemplateContent: [
      'Use these structures for this review.',
      '### Handoff to `planner` (your output)',
      '# Enhancer → Planner',
    ].join('\n'),
    referencesXml: [
      '<handoff-template for="planner->builder" team="duo">',
      '# Planner → Builder content',
      '</handoff-template>',
      '<handoff-template for="planner->user" team="duo">',
      '# Planner → User content',
      '</handoff-template>',
    ].join('\n'),
    plannerCheckIn: '# Draft\n\nDo this work\n',
    cliCompleteCommand:
      "chatroom enhancer complete --chatroom-id=room-abc --job-id=job-123 << 'CHATROOM_ENHANCER_END'",
  };

  it('contains the job-id attribute', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('job-id="job-123"');
  });

  it('contains handoff-templates and references blocks', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<handoff-templates>');
    expect(result).toContain('</handoff-templates>');
    expect(result).toContain('<references>');
    expect(result).toContain('</references>');
  });

  it('output template is inside handoff-templates, not references', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('### Handoff to `planner` (your output)');
  });

  it('builder reference template is inside references, not handoff-templates', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).not.toContain('Planner → Builder content<');
    expect(result).toContain('Planner → Builder content');
  });

  it('contains reference wrapper with for and team attributes', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('handoff-template for="planner->builder" team="duo"');
    expect(result).toContain('handoff-template for="planner->user" team="duo"');
  });

  it('contains <planner-check-in> section', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<planner-check-in>');
    expect(result).toContain('</planner-check-in>');
  });

  it('forbids codebase exploration in requirements', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('No codebase exploration');
    expect(result).toContain('do not investigate the repository');
  });

  it('references handoff-templates and references for output and alignment', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Handoff to `planner`');
    expect(result).toContain('<handoff-template for="planner->builder">');
    expect(result).toContain('<handoff-template for="planner->user">');
  });

  it('requirements mention references', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<references>');
  });

  it('contains requirements list', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Single-turn only.');
    expect(result).toContain('No tools');
  });
});
