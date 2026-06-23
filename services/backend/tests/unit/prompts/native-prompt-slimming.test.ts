import { describe, expect, test } from 'vitest';

import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from '../../../prompts/native/task-started-content';

describe('native task-started content', () => {
  test('entry point prompt describes classifications without task read or injection', () => {
    const prompt = getNativeTaskStartedPrompt({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    expect(prompt).not.toMatch(/task read/i);
    expect(prompt).not.toMatch(/inject/i);
    expect(prompt).toMatch(/question/i);
    expect(prompt).not.toContain('view-template');
  });

  test('handoff recipient prompt is minimal', () => {
    const prompt = getNativeTaskStartedPromptForHandoffRecipient();
    expect(prompt).toContain('Begin immediately');
    expect(prompt).not.toMatch(/task read/i);
  });
});

describe('native task delivery', () => {
  test('includes task content and handoff commands only', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
    });

    expect(output).toContain('<task>');
    expect(output).toContain('hello');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**user**');
    expect(output).toContain('**builder**');
    expect(output).not.toMatch(/inject/i);
    expect(output).not.toContain('Classify');
  });
});
