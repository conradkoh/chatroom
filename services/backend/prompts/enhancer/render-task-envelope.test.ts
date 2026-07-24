import { describe, expect, it } from 'vitest';

import { renderEnhancerTaskEnvelope } from './render-task-envelope';

describe('renderEnhancerTaskEnvelope', () => {
  const params = {
    jobId: 'job-123',
    chatroomId: 'room-abc',
    targetId: 'handoff:planner-to-builder' as const,
    handoffTemplate: '# Planner → Builder\n\n## Goal\nDo the thing\n',
    draftHandoff: '# Draft\n\nDo this work\n',
    cliCompleteCommand:
      "chatroom enhancer complete --chatroom-id=room-abc --job-id=job-123 << 'CHATROOM_ENHANCER_END'",
  };

  it('contains the job-id attribute', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('job-id="job-123"');
  });

  it('contains <handoff-template> section', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<handoff-template>');
    expect(result).toContain('</handoff-template>');
  });

  it('contains <draft-handoff> section', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<draft-handoff>');
    expect(result).toContain('</draft-handoff>');
  });

  it('contains escaped template content', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Planner → Builder');
    expect(result).toContain('## Goal');
  });

  it('contains requirements list', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Single-turn only.');
    expect(result).toContain('No tools');
  });
});
