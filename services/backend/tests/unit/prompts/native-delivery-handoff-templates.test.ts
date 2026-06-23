import { describe, expect, test } from 'vitest';

import {
  handoffViewTemplateCommand,
  viewHandoffTemplate,
} from '../../../prompts/cli/handoff/view-template';
import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';

const BASE = {
  chatroomId: 'room-id',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: { _id: 'task-id', content: 'hello' },
  message: { _id: 'msg-id', senderRole: 'user' },
  availableHandoffTargets: ['builder', 'user'],
};

describe('handoff view-template', () => {
  test('resolves duo planner to user report', () => {
    const template = viewHandoffTemplate({
      role: 'planner',
      nextRole: 'user',
      teamId: 'duo',
    });
    expect(template).toContain('Report Template (Planner → User)');
  });

  test('resolves duo builder to planner handoff', () => {
    const template = viewHandoffTemplate({
      role: 'builder',
      nextRole: 'planner',
      teamId: 'duo',
    });
    expect(template).toContain('Handoff Template (Builder → Planner)');
  });

  test('command generator includes role pair and team', () => {
    expect(
      handoffViewTemplateCommand({
        cliEnvPrefix: 'PREFIX ',
        role: 'planner',
        nextRole: 'user',
        teamId: 'duo',
      })
    ).toBe(
      'PREFIX chatroom handoff view-template --role="planner" --next-role="user" --team-id="duo"'
    );
  });
});

describe('native eager handoff templates', () => {
  test('duo planner inlines user and builder templates with next steps to user', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'duo',
    });

    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('task from `user`');
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).not.toContain('handoff view-template');
  });

  test('duo builder inlines planner return template and next steps to planner', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'duo',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['planner'],
    });

    expect(output).toContain('--next-role="planner"');
    expect(output).toContain('task from `planner`');
    expect(output).toContain('Handoff Template (Builder → Planner)');
    expect(output).not.toContain('handoff view-template');
  });

  test('solo inlines user report template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'solo',
      teamId: 'solo',
      availableHandoffTargets: ['user'],
    });

    expect(output).toContain('Report Template (Solo → User)');
    expect(output).not.toContain('handoff view-template');
  });

  test('squad planner inlines user, builder, and reviewer templates', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'squad',
      availableHandoffTargets: ['builder', 'reviewer', 'user'],
    });

    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('--next-role="user"');
  });

  test('squad builder inlines reviewer template and next steps to planner sender', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'squad',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['reviewer', 'planner'],
    });

    expect(output).toContain('--next-role="planner"');
    expect(output).toContain('Handoff Template (Builder → Reviewer)');
  });
});
