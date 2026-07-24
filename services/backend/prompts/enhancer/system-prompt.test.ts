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

  it('focuses on immediate handoff improvements', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('immediate, actionable improvements');
  });

  it('does not contain hard-coded role references', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).not.toContain('planner→builder');
  });
});
