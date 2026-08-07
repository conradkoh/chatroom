import { describe, expect, it } from 'vitest';

import { renderEnhancerSystemPrompt } from './system-prompt';

describe('renderEnhancerSystemPrompt', () => {
  const params = {
    chatroomId: 'room-abc',
    jobId: 'job-123',
    cliEnvPrefix: '',
  };

  it('contains CHATROOM_ENHANCER_END delimiter', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('CHATROOM_ENHANCER_END');
  });

  it('contains enhancer complete command', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('enhancer complete');
  });

  it('contains the job-id in complete command', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('job-id=job-123');
  });

  it('encourages codebase investigation', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('read those files');
    expect(result).toContain('Use tools to investigate');
    expect(result).not.toContain('Do NOT explore the codebase');
  });

  it('references handoff-templates and references', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('<handoff-templates>');
    expect(result).toContain('<references>');
    expect(result).toContain('Handoff to `planner`');
    expect(result).toContain('planner→builder');
    expect(result).toContain('planner→user');
  });

  it('does not contain hard-coded role references with arrows in angle brackets', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).not.toContain('planner>builder');
  });

  it('scopes file-level edits to Suggested edits section only', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('Suggested edits');
    expect(result).not.toContain('Do NOT prescribe file-level edits, target code snippets');
    expect(result).toContain('Do NOT rewrite');
  });

  it('frames role as advisory adversarial reviewer', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('advisory');
    expect(result).toContain('bar raiser');
  });

  it('includes UI/UX validation and output order guidance', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('optional **UX** section');
    expect(result).toContain('Recommendations');
    expect(result).toContain('Suggested edits');
    expect(result).toContain('always last');
    expect(result).toContain('specific, targeted');
    expect(result).toContain('vague');
    expect(result).not.toContain('<ux-reference>');
    expect(result).not.toContain('abstract bullets');
    expect(result).not.toContain('stay abstract');
  });

  it('includes message history download guidance', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('## Message history');
    expect(result).toContain('messages download');
    expect(result).toContain('--role="enhancer"');
    expect(result).toContain('--chatroom-id="room-abc"');
    expect(result).toContain('Do not rely solely');
  });
});
