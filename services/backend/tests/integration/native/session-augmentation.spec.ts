/**
 * Planner and builder session augmentation (integration).
 *
 * Planner and builder always get a new session on task delivery, regardless of handoff body
 * content or handoff path.
 */

import { describe, expect, test } from 'vitest';

import { ChatroomScenario } from '../../helpers/chatroom-scenario';
import {
  assertNativeInjectionCompaction,
  expectNewSessionFromTaskContent,
} from '../../helpers/session-augmentation';

describe('Planner → builder session_augmentation (duo, native harness)', () => {
  async function setupPlannerBuilderScenario(sessionKey: string) {
    const scenario = await ChatroomScenario.create({
      sessionKey,
      team: 'duo-planner',
    });
    await scenario.configureRole({ role: 'planner', harness: 'cursor-sdk' });
    await scenario.configureRole({ role: 'builder', harness: 'cursor-sdk' });
    const { taskId: plannerTaskId } = await scenario.userSays('Ship feature A');
    await scenario.startTask('planner', plannerTaskId);
    return scenario;
  }

  test('builder handoff with no augmentation section → new_session preamble', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-default-new-session');

    const delegation = [
      '## Goal',
      'Implement unrelated payments API',
      '## Files to implement',
      '- `src/payments.ts`',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expect(taskContent).not.toContain('Session Augmentation');
    expectNewSessionFromTaskContent(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'new_session');
    expect(injection).toContain('Implement unrelated payments API');
  });

  test('builder handoff with explicit session_augmentation=none → still new_session', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-none-override');

    const delegation = [
      '## Goal',
      'Small follow-up',
      '## Session Augmentation',
      '// data:agent.session_augmentation=none',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expectNewSessionFromTaskContent(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'new_session');
  });

  test('builder handoff with explicit session_augmentation=new_session → new_session preamble', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-explicit-new-session');

    const delegation = [
      '## Goal',
      'Add dark mode toggle',
      '## Session Augmentation',
      '// data:agent.session_augmentation=new_session',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expectNewSessionFromTaskContent(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'new_session');
  });

  test('planner gets new_session after a handoff back from an enhancement path', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-planner-after-enhancer');

    await scenario.handoff('planner', 'builder', '## Goal\nEnhance this implementation');
    const builderTaskId = await scenario.pendingTaskFor('builder');
    await scenario.startTask('builder', builderTaskId);
    await scenario.handoff('builder', 'planner', '## Summary\nEnhanced handoff');

    const nextPlannerTaskId = await scenario.pendingTaskFor('planner');
    const taskContent = await scenario.taskContent(nextPlannerTaskId);
    const injection = await scenario.nativeInjectionPromptFor(
      'planner',
      nextPlannerTaskId,
      taskContent
    );

    expectNewSessionFromTaskContent(taskContent);
    assertNativeInjectionCompaction(injection, 'new_session');
    expect(injection).toContain('Enhanced handoff');
  });
});
