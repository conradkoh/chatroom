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
    task: { _id: 'task-id', content: 'Do the work' },
    message: { _id: 'msg-id', senderRole: scenario.senderRole },
    availableHandoffTargets: scenario.availableHandoffTargets,
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

  test('planner answering user gets user verification reminder in next-steps', () => {
    const output = deliver(NATIVE_DELIVERY_SCENARIOS[1]);
    const nextSteps = output.slice(output.indexOf('<next-steps>'), output.indexOf('</next-steps>'));
    expect(nextSteps).toContain('pnpm typecheck && pnpm test');
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
  test('includes attached messages after task body', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: CLI_ENV,
      task: { _id: 'task-id', content: 'Main task' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      attachedMessages: [
        { _id: 'att-1', senderRole: 'user', content: 'Extra context from backlog' },
      ],
    });

    expect(output).toContain('<attached>');
    expect(output).toContain('Extra context from backlog');
    expect(output.indexOf('<attached>')).toBeGreaterThan(output.indexOf('Main task'));
    expect(output.indexOf('<next-steps>')).toBeGreaterThan(output.indexOf('</attached>'));
  });
});
