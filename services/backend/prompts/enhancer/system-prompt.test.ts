import { describe, expect, it } from 'vitest';

import { composeEnhancerSystemPrompt } from './system-prompt';

describe('composeEnhancerSystemPrompt', () => {
  const params = {
    chatroomId: 'room-abc',
    cliEnvPrefix: '',
    convexUrl: '',
  };

  it('frames the enhancer as a memoryless first-input design advisor', () => {
    const result = composeEnhancerSystemPrompt(params);
    expect(result).toContain('single-turn, memoryless **design advisor**');
    expect(result).toContain('stateful team entry point');
    expect(result).toContain('first planning input');
  });

  it('keeps task-scoped origin anchoring out of the role prompt', () => {
    const result = composeEnhancerSystemPrompt({
      ...params,
      entryPointRole: 'planner',
    });
    // Origin anchoring is task-scoped and delivered via the standard task
    // delivery prompt; the system prompt must not carry a placeholder origin.
    expect(result).not.toContain('<origin-user-message-id>');
    expect(result).not.toContain('Origin user message:');
  });

  it('renders the chatroom handoff command for the configured entry point', () => {
    const result = composeEnhancerSystemPrompt({
      ...params,
      entryPointRole: 'planner',
    });
    expect(result).toContain('chatroom handoff');
    expect(result).toContain('--next-role=planner');
    expect(result).toContain('CHATROOM_ENHANCER_END');
    expect(result).not.toContain('enhancer complete');
  });

  it('falls back to planner as the handoff target without an entry point', () => {
    const result = composeEnhancerSystemPrompt(params);
    expect(result).toContain('--next-role=planner');
  });

  it('includes shared general knowledge without planner handoff guidance', () => {
    const result = composeEnhancerSystemPrompt(params);
    expect(result).toContain('# Glossary');
    expect(result).toContain('get-system-prompt');
    expect(result).not.toContain('<handoff-templates>');
    expect(result).not.toContain('planner→builder');
    expect(result).not.toContain('user-report template');
  });

  it('requires single recommended design with frontend and data sections', () => {
    const result = composeEnhancerSystemPrompt(params);
    expect(result).toContain('per-flow UX quality checklist');
    expect(result).toContain('skill activate defragmentation');
    expect(result).toContain('<handoff-frontend-design>');
    expect(result).toContain('<handoff-data-design>');
    expect(result).toContain('**Files touched** are the last sections');
  });
});
