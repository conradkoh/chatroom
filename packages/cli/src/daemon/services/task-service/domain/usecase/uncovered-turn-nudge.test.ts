import { describe, expect, test } from 'vitest';

import { buildUncoveredTurnNudgePrompt } from './uncovered-turn-nudge.js';

describe('buildUncoveredTurnNudgePrompt', () => {
  const prompt = buildUncoveredTurnNudgePrompt({ taskId: 'task_42' });

  test('names the task', () => {
    expect(prompt).toContain('task_42');
  });

  test('gives the completion action: chatroom handoff', () => {
    expect(prompt).toContain('chatroom handoff');
  });

  test('gives the wait action: wait in the foreground, then hand off', () => {
    expect(prompt).toContain('wait for it in the foreground');
  });

  test('gives the one-line fallback when neither applies', () => {
    expect(prompt).toContain('one line saying what you are waiting on');
  });
});
