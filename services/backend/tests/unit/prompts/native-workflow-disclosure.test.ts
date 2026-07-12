/**
 * Native workflow disclosure — unit tests.
 *
 * Read this file to understand what native agents are told at task delivery:
 * section order, sender-based primary handoff, and eager template matrix.
 */

import { describe, expect, test } from 'vitest';

import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import {
  assertNativeDeliveryScenario,
  assertNativeDeliverySectionOrder,
  assertNativePrimaryHandoffInNextSteps,
} from '../../helpers/native-workflow-assertions';
import {
  NATIVE_DELIVERY_SCENARIOS,
  getNativeDeliveryScenario,
} from '../../helpers/native-workflow-fixtures';

const CLI_ENV = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';
const CHATROOM_ID = 'room-id';

function deliver(scenario: (typeof NATIVE_DELIVERY_SCENARIOS)[number]): string {
  return generateNativeTaskDeliveryOutput({
    chatroomId: CHATROOM_ID,
    role: scenario.role,
    teamId: scenario.teamId,
    cliEnvPrefix: CLI_ENV,
    task: { _id: 'task-id', content: scenario.taskContent ?? 'Do the work' },
    message: { _id: 'msg-id', senderRole: scenario.senderRole },
    availableHandoffTargets: scenario.availableHandoffTargets,
    isEntryPoint: scenario.role === 'planner' || scenario.role === 'solo',
  });
}

describe('Native task delivery — documented section order', () => {
  test('sections appear task → next-steps → handoff-templates → handoffs', () => {
    const output = deliver(NATIVE_DELIVERY_SCENARIOS[1]);
    assertNativeDeliverySectionOrder(output);
  });
});

describe('Native task delivery — sender-based primary handoff (step 2)', () => {
  test('when sender differs from current role, step 2 returns work to sender', () => {
    const output = deliver(getNativeDeliveryScenario('duo builder receives planner delegation'));
    assertNativePrimaryHandoffInNextSteps(output, 'planner', 'planner');
  });

  test('sender wins even when sender is absent from waiting-participants handoff list', () => {
    const output = deliver(getNativeDeliveryScenario('not in waiting-participants'));
    assertNativePrimaryHandoffInNextSteps(output, 'planner', 'planner');
    expect(output).toContain('**user**');
  });

  test('planner answering user does not mandate verification in next-steps', () => {
    const output = deliver(NATIVE_DELIVERY_SCENARIOS[1]);
    const nextSteps = output.slice(output.indexOf('<next-steps>'), output.indexOf('</next-steps>'));
    expect(nextSteps).not.toContain('⚠️ **User visibility:**');
    expect(nextSteps).not.toContain('pnpm typecheck && pnpm test');
    expect(nextSteps).not.toContain('No codebase verification needed');
  });

  test('planner receiving builder handback does not inject verification reminder', () => {
    const output = deliver(getNativeDeliveryScenario('planner receives builder handback'));
    const nextSteps = output.slice(output.indexOf('<next-steps>'), output.indexOf('</next-steps>'));
    expect(nextSteps).toContain('delivers it to `user`');
    expect(nextSteps).toContain('task from `builder`');
    expect(nextSteps).not.toContain('pnpm typecheck && pnpm test');
    expect(nextSteps).not.toContain('No codebase verification needed');
  });

  test('handoff templates include recipient visibility callout per target role', () => {
    const output = deliver(NATIVE_DELIVERY_SCENARIOS[1]);
    const templates = output.slice(
      output.indexOf('<handoff-templates>'),
      output.indexOf('</handoff-templates>')
    );
    expect(templates).toContain('⚠️ **CRITICAL — Recipient visibility**');
    expect(templates).toContain('handoff --next-role="user"');
    expect(templates).toContain('handoff --next-role="builder"');
    expect(templates).toContain('including direct replies like "Hello!"');
  });

  test('builder delivery includes planner visibility callout in handoff template', () => {
    const output = deliver(getNativeDeliveryScenario('duo builder receives planner delegation'));
    const templates = output.slice(
      output.indexOf('<handoff-templates>'),
      output.indexOf('</handoff-templates>')
    );
    expect(templates).toContain('⚠️ **CRITICAL — Recipient visibility**');
    expect(templates).toContain('The `planner` agent');
    expect(templates).toContain('handoff --next-role="planner"');
  });
});

describe('Native task delivery — eager handoff template matrix', () => {
  for (const scenario of NATIVE_DELIVERY_SCENARIOS) {
    test(scenario.label, () => {
      assertNativeDeliveryScenario(deliver(scenario), scenario);
    });
  }
});

describe('Native task delivery — omitted CLI harness framing', () => {
  test('does not include listen-loop, classify, or task-read instructions', () => {
    const output = deliver(NATIVE_DELIVERY_SCENARIOS[1]);
    expect(output).not.toContain('get-next-task');
    expect(output).not.toContain('Classify');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).not.toContain('Level A');
  });
});

describe('Native task delivery — attached context', () => {
  test('includes attached messages in unified attachments block before task body', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: CLI_ENV,
      task: { _id: 'task-id', content: 'Main task' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      sourceAttachments: {
        attachedMessages: [
          { _id: 'att-1', senderRole: 'user', content: 'Extra context from backlog' },
        ],
      },
    });

    expect(output).toContain('<attachments>');
    expect(output).toContain('type="message" message-id="att-1"');
    expect(output).toContain('Extra context from backlog');
    expect(output.indexOf('<attachments>')).toBeLessThan(output.indexOf('Main task'));
    expect(output.indexOf('<next-steps>')).toBeGreaterThan(output.indexOf('</attachments>'));
    expect(output).not.toContain('<attached>');
  });
});
