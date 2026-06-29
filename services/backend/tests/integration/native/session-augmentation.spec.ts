/**
 * Planner → builder session augmentation (integration).
 *
 * When the planner delegates a new unrelated slice, the handoff task body
 * controls whether the builder gets compaction, a new session, or continuation.
 * Default is new_session: the native injector prepends a new-session preamble.
 */

import { describe, expect, test } from 'vitest';

import { ChatroomScenario } from '../../helpers/chatroom-scenario';
import {
  assertNativeInjectionCompaction,
  expectCompactAugmentation,
  expectContinueSessionFromTaskContent,
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

  test('explicit new_session in handoff → builder injection uses new-session preamble', async () => {
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
    expect(injection).toContain('Add dark mode toggle');
  });

  test('explicit compact in handoff → builder injection uses compaction preamble', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-explicit-compact');

    const delegation = [
      '## Goal',
      'Summarize and continue on same slice',
      '## Session Augmentation',
      '// data:agent.session_augmentation=compact',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expectCompactAugmentation(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'compact');
    expect(injection).toContain('Summarize and continue on same slice');
  });

  test('missing Session Augmentation section → defaults to new_session for unrelated delegation', async () => {
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
  });

  test('session_augmentation=none → builder continues prior session (no preamble)', async () => {
    const scenario = await setupPlannerBuilderScenario('augment-continue-session');

    const delegation = [
      '## Goal',
      'Small follow-up on same slice',
      '## Session Augmentation',
      '// data:agent.session_augmentation=none',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expectContinueSessionFromTaskContent(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'none');
  });
});
