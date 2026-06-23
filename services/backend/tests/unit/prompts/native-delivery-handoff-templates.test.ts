import { describe, expect, test } from 'vitest';

import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';

const BASE = {
  chatroomId: 'room-id',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: { _id: 'task-id', content: 'hello' },
  message: { _id: 'msg-id', senderRole: 'user' },
  availableHandoffTargets: ['builder', 'user'],
};

describe('native delivery handoff templates', () => {
  test('duo planner delivery includes user report and delegation brief', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'duo',
    });

    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('<handoffs>');
    expect(output).not.toContain('get-next-task');
  });

  test('duo builder delivery includes builder to planner template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'duo',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['planner'],
    });

    expect(output).toContain('Handoff Template (Builder → Planner)');
  });

  test('solo delivery includes solo to user report template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'solo',
      teamId: 'solo',
      availableHandoffTargets: ['user'],
    });

    expect(output).toContain('Report Template (Solo → User)');
  });

  test('squad planner delivery includes user, builder, and reviewer templates', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'squad',
      availableHandoffTargets: ['builder', 'reviewer', 'user'],
    });

    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('Review Request Brief (Planner → Reviewer)');
  });

  test('squad builder delivery includes builder to reviewer template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'squad',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['reviewer'],
    });

    expect(output).toContain('Handoff Template (Builder → Reviewer)');
  });

  test('squad reviewer delivery includes planner and builder templates', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'reviewer',
      teamId: 'squad',
      message: { _id: 'msg-id', senderRole: 'builder' },
      availableHandoffTargets: ['planner', 'builder'],
    });

    expect(output).toContain('Review Outcome (Reviewer → Planner)');
    expect(output).toContain('Rework Feedback (Reviewer → Builder)');
  });
});
