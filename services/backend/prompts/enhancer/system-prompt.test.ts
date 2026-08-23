import { describe, expect, it } from 'vitest';

import { renderEnhancerSystemPrompt } from './system-prompt';

describe('renderEnhancerSystemPrompt', () => {
  const params = {
    chatroomId: 'room-abc',
    jobId: 'job-123',
    cliEnvPrefix: '',
    originUserMessageId: 'message-origin',
    convexUrl: '',
  };

  it('frames the enhancer as a memoryless first-input design advisor', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('single-turn, memoryless **design advisor**');
    expect(result).toContain('stateful team entry point');
    expect(result).toContain('first planning input');
  });

  it('requires independent history and repository grounding', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('--since-message-id="message-origin"');
    expect(result).toContain('messages download');
    expect(result).toContain('Inspect the repository');
    expect(result).toContain('actual user messages as authoritative');
  });

  it('includes shared general knowledge without planner handoff guidance', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('# Glossary');
    expect(result).toContain('context read');
    expect(result).toContain('get-system-prompt');
    expect(result).toContain('get-role-guidance');
    expect(result).toContain('truncated=true');
    expect(result).toContain('--since-message-id="message-origin"');
  });

  it('keeps planner workflow details out of enhancer context', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).not.toContain('<handoff-templates>');
    expect(result).not.toContain('<references>');
    expect(result).not.toContain('planner→builder');
    expect(result).not.toContain('planner→user');
    expect(result).not.toContain('planner-authored draft');
    expect(result).not.toContain('builder brief');
    expect(result).not.toContain('user-report template');
    expect(result).not.toContain('Suggested edits');
  });

  it('requires single recommended design with frontend and data sections', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('per-flow UX quality checklist');
    expect(result).toContain('skill activate defragmentation');
    expect(result).toContain('<handoff-frontend-design>');
    expect(result).toContain('<handoff-data-design>');
    expect(result).toContain('**Files touched** are the last sections');
    expect(result).not.toContain('optional **UX** section');
    expect(result).not.toContain('optional **Defragmentation** section');
  });

  it('contains the mandatory completion command for this job', () => {
    const result = renderEnhancerSystemPrompt(params);
    expect(result).toContain('CHATROOM_ENHANCER_END');
    expect(result).toContain('enhancer complete');
    expect(result).toContain('job-id=job-123');
  });
});
