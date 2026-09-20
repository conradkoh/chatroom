import { describe, expect, test } from 'vitest';

import { appendTaskDeliveryHandoffSections, type TaskDeliveryParams } from './core';

const BASE_PARAMS: TaskDeliveryParams = {
  chatroomId: 'room-id',
  role: 'planner',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  teamId: 'duo',
  task: { _id: 'task-id', content: 'Task body' },
  message: { _id: 'msg-id', senderRole: 'user' },
  availableHandoffTargets: ['builder', 'user'],
  isEntryPoint: true,
};

function renderHandoffSections(overrides: Partial<TaskDeliveryParams> = {}): string {
  const lines: string[] = [];
  appendTaskDeliveryHandoffSections(lines, { ...BASE_PARAMS, ...overrides });
  return lines.join('\n');
}

function expectNoEnhancerCeremony(output: string): void {
  expect(output).not.toContain('<handoff-enhancer>');
  expect(output).not.toContain('<enhancer-input>');
  expect(output).not.toContain('<handoff-enhancer-disabled>');
  expect(output).not.toContain('Immediately hand off the user request');
  expect(output).not.toContain('Planning Request (Planner → Enhancer)');
}

describe('appendTaskDeliveryHandoffSections — generic workflow', () => {
  test('entry-point user task recommends user and has no enhancer ceremony', () => {
    const output = renderHandoffSections();

    expect(output).toContain('1. Work on the task above.');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('When complete, you MUST run the handoff command');
    expectNoEnhancerCeremony(output);
  });

  test('entry-point task from a team member recommends user when available', () => {
    const output = renderHandoffSections({
      message: { _id: 'builder-msg', senderRole: 'builder' },
    });

    expect(output).toContain('--next-role="user"');
    expectNoEnhancerCeremony(output);
  });

  test('non-entry-point task returns to its sender', () => {
    const output = renderHandoffSections({
      role: 'builder',
      message: { _id: 'planner-msg', senderRole: 'planner' },
      availableHandoffTargets: ['planner', 'user'],
      isEntryPoint: false,
    });

    expect(output).toContain('--next-role="planner"');
    expectNoEnhancerCeremony(output);
  });

  test('configured specialist targets are ordinary advertised capability data', () => {
    const output = renderHandoffSections({
      availableHandoffTargets: ['architect', 'uiux-engineer', 'builder', 'user'],
    });

    expect(output).toContain('<handoffs>');
    expect(output).toContain('**architect**');
    expect(output).toContain('--next-role="architect"');
    expect(output).toContain('**uiux-engineer**');
    expectNoEnhancerCeremony(output);
  });

  test('Chat mode keeps direct-answer guidance without alternate ceremony', () => {
    const output = renderHandoffSections({ conversationMode: 'chat' });

    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Answer the user directly and concisely by default');
    expect(output).toContain('you may hand off to any advertised team target');
    expect(output).not.toContain('delegate to another agent');
    expect(output).toContain('--next-role="user"');
    expectNoEnhancerCeremony(output);
  });

  test('Enhance mode adds planner-owned design guidance for an entry-point user task', () => {
    const output = renderHandoffSections({
      role: 'planner',
      isEntryPoint: true,
      message: { _id: 'user-msg', senderRole: 'user' },
      availableHandoffTargets: ['architect', 'builder', 'user'],
      conversationMode: 'code:enhanced',
    });

    expect(output).not.toContain('<chat-mode>');
    expect(output).toContain('<enhance-mode>');
    expect(output).toContain('exactly one recommended design');
    expect(output).toContain('architect');
    expect(output).toContain('uiux-engineer');
    expect(output).toContain('--next-role="user"');
    expect(output).not.toContain('<handoff-enhancer>');
  });

  test.each([
    ['chat mode', { conversationMode: 'chat' as const }],
    ['ordinary code', { conversationMode: 'code' as const }],
    ['builder', { role: 'builder', conversationMode: 'code:enhanced' as const }],
    ['non-entry-point', { isEntryPoint: false, conversationMode: 'code:enhanced' as const }],
    [
      'non-user sender',
      {
        message: { _id: 'builder-msg', senderRole: 'builder' },
        conversationMode: 'code:enhanced' as const,
      },
    ],
    ['solo', { role: 'solo', conversationMode: 'code:enhanced' as const }],
  ])('does not add Enhance guidance for %s', (_label, overrides) => {
    const output = renderHandoffSections({
      role: 'planner',
      isEntryPoint: true,
      message: { _id: 'user-msg', senderRole: 'user' },
      ...overrides,
    });
    expect(output).not.toContain('<enhance-mode>');
  });

  test('a task from the configured ephemeral role follows standard intake recommendations', () => {
    const output = renderHandoffSections({
      message: { _id: 'ephemeral-msg', senderRole: 'enhancer' },
      availableHandoffTargets: ['builder', 'user'],
    });

    expect(output).toContain('--next-role="user"');
    expect(output).not.toContain('origin-user-message-id');
    expectNoEnhancerCeremony(output);
  });

  test('stale enhancer targets are omitted from capabilities and primary recommendations', () => {
    const output = renderHandoffSections({
      message: { _id: 'stale-msg', senderRole: 'enhancer' },
      availableHandoffTargets: ['enhancer', 'architect', 'user'],
      isEntryPoint: false,
    });

    expect(output).not.toContain('**enhancer**');
    expect(output).not.toContain('--next-role="enhancer"');
    expect(output).toContain('--next-role="architect"');
    expectNoEnhancerCeremony(output);
  });
});
