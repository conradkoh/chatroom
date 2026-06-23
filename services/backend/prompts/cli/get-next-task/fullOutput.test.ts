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
  test('native mode returns task content, lazy template hints, and handoff commands', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).toContain('<task>');
    expect(output).toContain('Implement the feature');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**planner**');
    expect(output).not.toContain('task injection');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('handoff view-template --role="builder" --next-role="planner"');
    expect(output).not.toContain('Handoff Template (Builder → Planner)');
  });

  test('CLI mode still contains get-next-task (regression)', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
    });

    expect(output).toContain('get-next-task');
    expect(output).toContain('grace-period cooldowns');
    expect(output).not.toContain('<handoffs>');
  });

  test('native planner user message lists handoff targets and lazy template hints', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      role: 'planner',
      teamId: 'duo',
      isEntryPoint: true,
      message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
      availableHandoffTargets: ['builder', 'user'],
      nativeIntegration: true,
      task: { _id: 'task-id', content: 'hello' },
    });

    expect(output).toContain('hello');
    expect(output).toContain('**user**');
    expect(output).toContain('**builder**');
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('handoff view-template --role="planner" --next-role="user"');
    expect(output).toContain('handoff view-template --role="planner" --next-role="builder"');
    expect(output).not.toContain('Report Template (Planner → User)');
    expect(output).not.toContain('Classify');
  });
});
