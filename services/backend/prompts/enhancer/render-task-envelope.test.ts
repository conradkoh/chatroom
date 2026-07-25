import { describe, expect, it } from 'vitest';

import { renderEnhancerTaskEnvelope } from './render-task-envelope';

describe('renderEnhancerTaskEnvelope', () => {
  const params = {
    jobId: 'job-123',
    chatroomId: 'room-abc',
    targetId: 'handoff:planner-to-builder' as const,
    referenceHandoffTemplatesContent: [
      'Use these structures for this review.',
      '### Handoff to `planner` (your output)',
      '# Enhancer → Planner',
      '### Handoff to `builder` (planner reference)',
      '# Planner → Builder',
      '### Handoff to `user` (planner reference)',
      '# Planner → User',
    ].join('\n'),
    draftHandoff: '# Draft\n\nDo this work\n',
    cliCompleteCommand:
      "chatroom enhancer complete --chatroom-id=room-abc --job-id=job-123 << 'CHATROOM_ENHANCER_END'",
  };

  it('contains the job-id attribute', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('job-id="job-123"');
  });

  it('contains handoff-templates disclosure', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<handoff-templates>');
    expect(result).toContain('</handoff-templates>');
    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).toContain('### Handoff to `builder` (planner reference)');
    expect(result).toContain('### Handoff to `user` (planner reference)');
  });

  it('contains <draft-handoff> section', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<draft-handoff>');
    expect(result).toContain('</draft-handoff>');
  });

  it('contains escaped template content', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Planner → Builder');
    expect(result).toContain('Planner → User');
  });

  it('forbids codebase exploration in requirements', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('No codebase exploration');
    expect(result).toContain('do not investigate the repository');
  });

  it('references handoff-templates for output and planner alignment', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Handoff to `planner`');
    expect(result).toContain('Handoff to `builder`');
    expect(result).toContain('Handoff to `user`');
  });

  it('contains requirements list', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Single-turn only.');
    expect(result).toContain('No tools');
  });
});
