import { describe, expect, it } from 'vitest';

import { renderEnhancerSystemPrompt } from './system-prompt';

describe('renderEnhancerSystemPrompt', () => {
  const params = {
    chatroomId: 'room-abc',
    jobId: 'job-123',
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

  it('forbids codebase exploration', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('Do NOT explore the codebase');
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

  it('forbids file-level edit prescriptions', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('Do NOT prescribe file-level edits');
    expect(result).toContain('Do NOT rewrite');
  });

  it('frames role as advisory adversarial reviewer', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('advisory');
    expect(result).toContain('bar raiser');
  });
});
