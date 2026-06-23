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

describe('native lazy handoff template hints', () => {
  test('duo planner hints user and builder view-template commands without inline bodies', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'duo',
    });

    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('handoff view-template --role="planner" --next-role="user"');
    expect(output).toContain('handoff view-template --role="planner" --next-role="builder"');
    expect(output).not.toContain('Report Template (Planner → User)');
    expect(output).not.toContain('Delegation Brief (Planner → Builder)');
  });

  test('duo builder hints planner return template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'duo',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['planner'],
    });

    expect(output).toContain('handoff view-template --role="builder" --next-role="planner"');
    expect(output).not.toContain('Handoff Template (Builder → Planner)');
  });

  test('solo hints user report template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'solo',
      teamId: 'solo',
      availableHandoffTargets: ['user'],
    });

    expect(output).toContain('handoff view-template --role="solo" --next-role="user"');
  });

  test('squad planner hints user, builder, and reviewer', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'planner',
      teamId: 'squad',
      availableHandoffTargets: ['builder', 'reviewer', 'user'],
    });

    expect(output).toContain('--next-role="user"');
    expect(output).toContain('--next-role="builder"');
    expect(output).toContain('--next-role="reviewer"');
  });

  test('squad builder hints reviewer template', () => {
    const output = generateNativeTaskDeliveryOutput({
      ...BASE,
      role: 'builder',
      teamId: 'squad',
      message: { _id: 'msg-id', senderRole: 'planner' },
      availableHandoffTargets: ['reviewer'],
    });

    expect(output).toContain('handoff view-template --role="builder" --next-role="reviewer"');
  });
});
