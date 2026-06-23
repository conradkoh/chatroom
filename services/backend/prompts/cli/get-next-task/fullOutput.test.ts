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
  test('native mode returns task content, eager templates, next steps, and handoff commands', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).toContain('<task>');
    expect(output).toContain('Implement the feature');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**planner**');
    expect(output).not.toContain('task injection');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Handoff Template (Builder → Planner)');
    expect(output).not.toContain('handoff view-template');
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

  test('native planner user message lists handoff targets and eager templates', () => {
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
    expect(output).toContain('<next-steps>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('**user**');
    expect(output).toContain('**builder**');
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).not.toContain('Classify');
  });
});
