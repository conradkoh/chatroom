import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from './fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature',
  },
  message: {
    _id: 'test-message-id',
    senderRole: 'planner',
    content: 'Please implement',
  },
  currentContext: null,
  originMessage: {
    senderRole: 'user',
    content: 'Please implement',
    classification: 'new_feature',
  },
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: false,
  availableHandoffTargets: ['planner'],
};

describe('generateFullCliOutput — nativeIntegration', () => {
  test('native mode omits get-next-task and uses injection language', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: true,
    });

    expect(output).not.toMatch(/blocking `get-next-task`/i);
    expect(output).toContain('injected into your native harness session');
    expect(output).toContain('next task will be injected automatically');
    expect(output).not.toContain('grace-period cooldowns');
    expect(output).toContain('<task-content>');
    expect(output).toContain('Implement the feature');
    expect(output).not.toContain('Context compacted?');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('in_progress automatically');
    expect(output).not.toContain('Delegation Brief');
    expect(output).not.toContain('Report Template');
  });

  test('CLI mode still contains get-next-task (regression)', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
    });

    expect(output).toContain('get-next-task');
    expect(output).toContain('grace-period cooldowns');
    expect(output).not.toContain('injected into your native harness session');
  });

  test('native planner user message uses lightweight classification branches', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      role: 'planner',
      isEntryPoint: true,
      message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
      availableHandoffTargets: ['builder', 'user'],
      nativeIntegration: true,
      task: { _id: 'task-id', content: 'hello' },
    });

    expect(output).not.toContain('Delegation Brief');
    expect(output).not.toContain('Report Template');
    expect(output).toMatch(/question.*greetings/i);
  });
});
