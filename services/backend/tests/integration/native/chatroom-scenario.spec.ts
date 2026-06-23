/**
 * ChatroomScenario — native prompt orchestration integration tests.
 *
 * Closed-loop scenarios: user message → delivery prompt → handoff → next delivery.
 * No daemon, harness, or LLM required.
 */

import { describe, expect, test } from 'vitest';

import { ChatroomScenario } from '../../helpers/chatroom-scenario';
import {
  assertNativeDeliveryContract,
  assertNativeHandoffOutput,
} from '../../helpers/native-delivery-contract';

describe('ChatroomScenario — native prompt orchestration', () => {
  test('user greeting → planner native delivery contract', async () => {
    const scenario = await ChatroomScenario.create({ sessionKey: 'scenario-user-hello' });
    await scenario.configureRole({ role: 'planner' });

    const { taskId } = await scenario.userSays('hello');
    const delivery = await scenario.deliveryPromptFor('planner', taskId);
    const injection = await scenario.nativeInjectionPromptFor('planner', taskId, 'hello');

    assertNativeDeliveryContract(delivery, {
      taskContent: 'hello',
      handoffTarget: 'user',
    });
    assertNativeDeliveryContract(injection, {
      taskContent: 'hello',
      handoffTarget: 'user',
    });
    expect(injection).toContain('<handoff-templates>');
    expect(injection).toContain('Report Template (Planner → User)');
    expect(injection).toContain('Delegation Brief (Planner → Builder)');
  });

  test('planner handoff to user returns minimal native output', async () => {
    const scenario = await ChatroomScenario.create({ sessionKey: 'scenario-handoff-user' });
    await scenario.configureRole({ role: 'planner' });

    const { taskId } = await scenario.userSays('hello');
    await scenario.startTask('planner', taskId);

    const { mutation, cliOutput } = await scenario.handoff(
      'planner',
      'user',
      '---MESSAGE---\nHi! How can I help?'
    );

    expect(mutation.success).toBe(true);
    expect(mutation.supportsNativeIntegration).toBe(true);
    assertNativeHandoffOutput(cliOutput);
    expect(cliOutput).toContain('handed off to user');
  });

  test('planner → builder handoff creates builder delivery with handoffs', async () => {
    const scenario = await ChatroomScenario.create({
      sessionKey: 'scenario-planner-builder',
      team: 'duo-planner',
    });
    await scenario.configureRole({ role: 'planner' });
    await scenario.configureRole({ role: 'builder' });

    const { taskId } = await scenario.userSays('Add dark mode to settings');
    await scenario.startTask('planner', taskId);

    const delegation = [
      '## Goal',
      'Add dark mode toggle to settings page',
      '## Session Management',
      '// data:agent.compress_context=new_session',
    ].join('\n');

    const { mutation, cliOutput } = await scenario.handoff('planner', 'builder', delegation);
    expect(mutation.success).toBe(true);
    assertNativeHandoffOutput(cliOutput);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const builderContent = await scenario.taskContent(builderTaskId);
    const builderDelivery = await scenario.deliveryPromptFor('builder', builderTaskId);
    const builderInjection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      builderContent
    );

    assertNativeDeliveryContract(builderDelivery, {
      taskContent: 'Add dark mode toggle',
      handoffTarget: 'planner',
    });
    expect(builderDelivery).toContain('Handoff Template (Builder → Planner)');
    expect(builderInjection).toContain('Context was compacted');
    expect(builderInjection).toContain('Add dark mode toggle');
  });

  test('CLI harness delivery still references get-next-task (regression)', async () => {
    const scenario = await ChatroomScenario.create({ sessionKey: 'scenario-cli-harness' });
    await scenario.configureRole({ role: 'planner', harness: 'opencode' });

    const { taskId } = await scenario.userSays('hello');
    const delivery = await scenario.deliveryPromptFor('planner', taskId);

    expect(delivery).toContain('get-next-task');
    expect(delivery).not.toContain('<handoffs>');
  });
});
