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

describe('Native task delivery — architect and UI/UX design briefs', () => {
  for (const scenario of NATIVE_DELIVERY_SCENARIOS.filter((candidate) =>
    ['architect', 'uiux-engineer'].includes(candidate.role)
  )) {
    test(`${scenario.teamId}:${scenario.role} injects the rigid role-specific brief`, () => {
      const output = deliver(scenario);
      const start = output.indexOf('<handoff-templates>');
      const end = output.indexOf('</handoff-templates>');
      const templates = output.slice(start, end);

      for (const heading of [
        '## Summary',
        '## Goal',
        '## Key Knowledge for High Quality Bar',
        '## Force Multipliers',
        '## Files to implement (exhaustive, file-level)',
        '## Shared contracts',
        '## Requirements (acceptance criteria)',
        '## What to avoid',
        '## Skills to activate',
        '## Out of scope',
      ]) {
        expect(templates).toContain(heading);
      }
      expect(templates).toContain(`--next-role="${scenario.primaryHandoffTarget}"`);
      if (scenario.role === 'architect') {
        expect(templates).toMatch(
          /domain model|concurrent writers|Convex reactivity|migration\/backfill/i
        );
      } else {
        expect(templates).toMatch(
          /loading, empty, error, success|keyboard shortcuts|Tailwind|UI\/integration/i
        );
      }
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

describe('Native task delivery — Chat mode eager template matrix', () => {
  test('duo planner chat entry-point user keeps base templates without enhancer-specific injection', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: CLI_ENV,
      task: { _id: 'task-id', content: 'Hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      isEntryPoint: true,
      conversationMode: 'chat',
    });

    // Eager templates keep the full duo planner base (user + builder)
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Handoff to `user`');
    expect(output).toContain('Handoff to `builder`');
    // No enhancer-specific template is injected in Chat or any other mode.
    expect(output).not.toContain('Handoff to `enhancer`');
    // Alternate handoff targets remain advertised
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**builder**');
    // Chat-mode guidance
    expect(output).toContain('<chat-mode>');
    expect(output).toContain('Do not run `chatroom context read` or `chatroom context new`');
  });

  test('duo planner Enhance entry-point user task includes planner-owned design guidance', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: CLI_ENV,
      task: { _id: 'task-id', content: 'Design the feature' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'architect', 'uiux-engineer', 'user'],
      isEntryPoint: true,
      conversationMode: 'code:enhanced',
    });

    expect(output).toContain('<enhance-mode>');
    expect(output).toContain('exactly one recommended design');
    expect(output).toContain('architect');
    expect(output).toContain('uiux-engineer');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<chat-mode>');
  });

  test('solo chat entry-point user keeps base templates and advertises design roles', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role: 'solo',
      teamId: 'solo',
      cliEnvPrefix: CLI_ENV,
      task: { _id: 'task-id', content: 'Hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['user', 'architect', 'uiux-engineer'],
      isEntryPoint: true,
      conversationMode: 'chat',
    });

    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Handoff to `user`');
    expect(output).toContain('Handoff to `architect`');
    expect(output).toContain('Handoff to `uiux-engineer`');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**user**');
    expect(output).toContain('**architect**');
    expect(output).toContain('**uiux-engineer**');
    expect(output).not.toContain('enhancer');
    expect(output).toContain('<chat-mode>');
  });
});
