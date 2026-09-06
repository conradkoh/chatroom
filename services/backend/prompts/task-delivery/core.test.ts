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

describe('appendTaskDeliveryHandoffSections — enhancer enabled', () => {
  const enhancerParams: Partial<TaskDeliveryParams> = {
    plannerEnhancerEnabled: true,
    availableHandoffTargets: ['enhancer', 'builder', 'user'],
  };

  test('user message requires immediate enhancer handoff before planner work', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('Immediately hand off the user request');
    expect(output).toContain('before planning, researching, or drafting');
    expect(output).toContain('Run this handoff command as your final action now');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).toContain('Planning Request (Planner → Enhancer)');
    expect(output).toContain('<additional-context>');
    expect(output).not.toContain('<grounding>');
    expect(output).not.toContain('<builder-handoff>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('user → enhancer → planner → [loop builder → planner] → user');
  });

  test('builder handback does not offer another enhancer pass', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      availableHandoffTargets: ['builder', 'user'],
      message: { _id: 'builder-msg', senderRole: 'builder' },
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).not.toContain('--next-role="enhancer"');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('--next-role="user"');
  });

  test('enhancer input targets builder and omits enhancer request template', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      message: { _id: 'enh-msg', senderRole: 'enhancer' },
    });

    expect(output).toContain('<enhancer-input>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="builder"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('solo uses enhancer first, then resumes implementation and user delivery', () => {
    const userOutput = renderHandoffSections({
      role: 'solo',
      teamId: 'solo',
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'user'],
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(userOutput).toContain('--next-role="enhancer"');
    expect(userOutput).toContain('Planning Request (Solo → Enhancer)');
    expect(userOutput).toContain('user → enhancer → solo → user');
    expect(userOutput).not.toContain('Handoff to `builder`');

    const enhancerOutput = renderHandoffSections({
      role: 'solo',
      teamId: 'solo',
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['user'],
      message: { _id: 'enh-msg', senderRole: 'enhancer' },
    });

    expect(enhancerOutput).toContain('<enhancer-input>');
    expect(enhancerOutput).toContain('--next-role="user"');
    expect(enhancerOutput).not.toContain('Handoff to `enhancer`');
  });
});

describe('appendTaskDeliveryHandoffSections — enhancer disabled', () => {
  test('user message omits enhancer and targets user', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: false,
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `builder`');
  });
});

describe('appendTaskDeliveryHandoffSections — conversationMode', () => {
  const enhancerParams: Partial<TaskDeliveryParams> = {
    plannerEnhancerEnabled: true,
    availableHandoffTargets: ['enhancer', 'builder', 'user'],
  };

  test('chat mode keeps capabilities advertised and omits enhancer ceremony', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      conversationMode: 'chat',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    // Chat-mode direct recommendation present
    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Answer the user directly and concisely by default');
    expect(output).toContain('you may hand off to any advertised team target');
    expect(output).not.toContain('delegate to another agent');
    expect(output).toContain('</chat-mode>');

    // No enhancer ceremony guidance sections
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<handoff-enhancer-disabled>');

    // Final user handoff present (primary recommendation is user)
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `user`');

    // Advertised team capabilities remain rendered (mode never filters them)
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**builder**');
    expect(output).toContain('Handoff to `builder`');
  });

  test('chat mode with legacy plannerEnhancerEnabled: true still targets user', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      conversationMode: 'chat',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<chat-mode>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).toContain('--next-role="user"');
  });

  test('code mode omits chat-mode guidance and retains enhancer-disabled guidance', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: false,
      availableHandoffTargets: ['builder', 'user'],
      conversationMode: 'code',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).not.toContain('<chat-mode>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).toContain('<handoff-enhancer-disabled>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('code:enhanced mode retains enhancer guidance', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      conversationMode: 'code:enhanced',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).not.toContain('<chat-mode>');
    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('--next-role="enhancer"');
  });

  test('undefined mode retains legacy boolean behaviour', () => {
    const outputTrue = renderHandoffSections({
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      message: { _id: 'user-msg', senderRole: 'user' },
    });
    expect(outputTrue).toContain('<handoff-enhancer>');
    expect(outputTrue).toContain('--next-role="enhancer"');

    const outputFalse = renderHandoffSections({
      plannerEnhancerEnabled: false,
      availableHandoffTargets: ['builder', 'user'],
      message: { _id: 'user-msg', senderRole: 'user' },
    });
    expect(outputFalse).not.toContain('<handoff-enhancer>');
    expect(outputFalse).toContain('<handoff-enhancer-disabled>');
  });

  test('code:enhanced with stale plannerEnhancerEnabled: false still includes enhancer guidance', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: false,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      conversationMode: 'code:enhanced',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Immediately hand off the user request');
    expect(output).toContain('Planning Request (Planner → Enhancer)');
    expect(output).toContain('<additional-context>');
  });

  test('code with stale plannerEnhancerEnabled: true omits enhancer guidance and targets user', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      conversationMode: 'code',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).not.toContain('<chat-mode>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).toContain('<handoff-enhancer-disabled>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('chat with stale plannerEnhancerEnabled: true remains direct/no enhancer', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      conversationMode: 'chat',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Answer the user directly and concisely');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<handoff-enhancer-disabled>');
    expect(output).toContain('--next-role="user"');
  });

  test('chat entry-point user output keeps capabilities advertised and omits enhancer ceremony', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      conversationMode: 'chat',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Do not run `chatroom context read` or `chatroom context new`');
    expect(output).toContain('--next-role="user"');
    expect(output).not.toContain('delegate to another agent');

    // Alternate team capabilities remain rendered (capability data, not filtered by mode)
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**builder**');
    expect(output).toContain('Handoff to `builder`');

    // Enhancer ceremony/template remains absent for Chat even when scalar legacy says enabled
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');

    // No proof-rich sections
    expect(output).not.toContain('<handoff-proofs>');
    expect(output).not.toContain('<handoff-direction>');
    expect(output).not.toContain('<handoff-action>');
    expect(output).not.toContain('Not Applicable.');
  });

  test('solo chat entry-point user keeps advertised targets and omits enhancer template', () => {
    const output = renderHandoffSections({
      role: 'solo',
      teamId: 'solo',
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['user', 'enhancer'],
      conversationMode: 'chat',
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Do not run `chatroom context read` or `chatroom context new`');
    expect(output).toContain('--next-role="user"');
    // Supplied capability data still renders (user + enhancer were advertised)
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**user**');
    expect(output).toContain('**enhancer**');
    // No enhancer ceremony guidance
    expect(output).not.toContain('<handoff-enhancer>');
  });

  test('delegated/non-entry-point chat task retains normal target/template behavior', () => {
    const output = renderHandoffSections({
      role: 'builder',
      conversationMode: 'chat',
      availableHandoffTargets: ['planner'],
      isEntryPoint: false,
      message: { _id: 'planner-msg', senderRole: 'planner' },
    });

    // No chat-mode guidance for non-entry-point
    expect(output).not.toContain('<chat-mode>');
    // Normal handoff targets present
    expect(output).toContain('<handoffs>');
    expect(output).toContain('--next-role="planner"');
    expect(output).toContain('Handoff to `planner`');
  });
});
