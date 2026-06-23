import { describe, expect, test } from 'vitest';

import { appendNativePlannerUserNextSteps } from '../../../prompts/native/planner-user-next-steps';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from '../../../prompts/native/task-started-content';

describe('native task-started content', () => {
  test('entry point prompt omits task read and mentions inline injection', () => {
    const prompt = getNativeTaskStartedPrompt({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    expect(prompt).not.toMatch(/after `task read`/i);
    expect(prompt).toContain('inline with injection');
    expect(prompt).toMatch(/question.*greetings/i);
    expect(prompt).not.toContain('view-template');
  });

  test('handoff recipient prompt tells agent not to run task read', () => {
    const prompt = getNativeTaskStartedPromptForHandoffRecipient();
    expect(prompt).toMatch(/do not run `task read`/i);
    expect(prompt).toContain('in_progress');
  });
});

describe('native planner user next steps', () => {
  test('uses classification branches without inlined delegation or report templates', () => {
    const lines: string[] = [];
    appendNativePlannerUserNextSteps(lines, {
      chatroomId: 'room-id',
      role: 'planner',
      taskId: 'task-id',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      availableHandoffTargets: ['builder', 'user'],
    });
    const output = lines.join('\n');

    expect(output).toContain('Classify');
    expect(output).toMatch(/question.*greetings/i);
    expect(output).toContain('handoff');
    expect(output).not.toContain('Delegation Brief');
    expect(output).not.toContain('Report Template');
    expect(output).not.toContain('context view-template');
    expect(output).not.toContain('Delegate ONE slice');
  });
});
