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
    expect(output).toContain('Request Forward (Planner → Enhancer)');
    expect(output).toContain('<request>');
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
