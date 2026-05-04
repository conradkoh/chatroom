import { describe, it, expect } from 'vitest';

import { composeSystemPrompt, CHATROOM_PROMPT_SEPARATOR } from './compose-system-prompt';

describe('composeSystemPrompt', () => {
  it('returns undefined when both prompts are empty', () => {
    expect(composeSystemPrompt('', '')).toBeUndefined();
  });

  it('returns undefined when both prompts are whitespace-only', () => {
    expect(composeSystemPrompt('   ', '   ')).toBeUndefined();
  });

  it('returns agent prompt unchanged when chatroom prompt is empty', () => {
    expect(composeSystemPrompt('agent prompt', '')).toBe('agent prompt');
  });

  it('returns chatroom prompt unchanged when agent prompt is undefined', () => {
    expect(composeSystemPrompt(undefined, 'chatroom prompt')).toBe('chatroom prompt');
  });

  it('returns chatroom prompt unchanged when agent prompt is empty string', () => {
    expect(composeSystemPrompt('', 'chatroom prompt')).toBe('chatroom prompt');
  });

  it('returns trim agent prompt when chatroom prompt is empty', () => {
    expect(composeSystemPrompt('  agent prompt  ', '')).toBe('agent prompt');
  });

  it('returns trim chatroom prompt when agent prompt is empty', () => {
    expect(composeSystemPrompt('', '  chatroom prompt  ')).toBe('chatroom prompt');
  });

  it('returns both prompts concatenated with separator when both present', () => {
    const result = composeSystemPrompt('agent prompt', 'chatroom prompt');
    expect(result).toBe(`agent prompt${CHATROOM_PROMPT_SEPARATOR}chatroom prompt`);
  });

  it('trims both prompts before concatenation', () => {
    const result = composeSystemPrompt('  agent prompt  ', '  chatroom prompt  ');
    expect(result).toBe(`agent prompt${CHATROOM_PROMPT_SEPARATOR}chatroom prompt`);
  });

  it('uses the CHATROOM_PROMPT_SEPARATOR constant', () => {
    expect(CHATROOM_PROMPT_SEPARATOR).toBe('\n\n# Chatroom Role & Instructions (Important)\n\n');
  });
});
