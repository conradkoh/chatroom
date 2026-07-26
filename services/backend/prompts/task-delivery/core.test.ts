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

  test('user message includes enhancer guidance and targets enhancer first', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('One check-in per builder delegation');
    expect(output).toContain('planner → enhancer → planner → builder');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).not.toContain('<enhancer-review>');
    expect(output).toContain(
      'user → [loop planner → enhancer → planner → builder → planner] → user'
    );
  });

  test('builder handback includes enhancer guidance for next slice delegation', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      message: { _id: 'builder-msg', senderRole: 'builder' },
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('One check-in per builder delegation');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).not.toContain('<enhancer-review>');
    expect(output).toContain('--next-role="user"');
  });

  test('enhancer feedback includes review guidance and omits enhancer check-in template', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      message: { _id: 'enh-msg', senderRole: 'enhancer' },
    });

    expect(output).toContain('<enhancer-review>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="builder"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('builder handback omits enhancer guidance when disabled', () => {
    const output = renderHandoffSections({
      ...enhancerParams,
      plannerEnhancerEnabled: false,
      message: { _id: 'builder-msg', senderRole: 'builder' },
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-review>');
    expect(output).toContain('--next-role="user"');
  });
});

describe('appendTaskDeliveryHandoffSections — enhancer disabled', () => {
  test('user message omits enhancer guidance and targets user', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: false,
      message: { _id: 'user-msg', senderRole: 'user' },
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-review>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('builder handback targets user without enhancer sections', () => {
    const output = renderHandoffSections({
      plannerEnhancerEnabled: false,
      message: { _id: 'builder-msg', senderRole: 'builder' },
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-review>');
    expect(output).toContain('--next-role="user"');
  });
});
