/**
 * Planner → builder session management (integration).
 *
 * When the planner delegates a new unrelated slice, the handoff task body
 * controls whether the builder gets a fresh context. Default is new_session:
 * the native injector prepends a compaction header so the SDK starts clean.
 */

import { describe, expect, test } from 'vitest';

import { ChatroomScenario } from '../../helpers/chatroom-scenario';
import {
  assertNativeInjectionCompaction,
  expectContinueSessionFromTaskContent,
  expectNewSessionFromTaskContent,
} from '../../helpers/compress-context-session';

describe('Planner → builder compress_context (duo, native harness)', () => {
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

  test('explicit new_session in handoff → builder injection compacts context', async () => {
    const scenario = await setupPlannerBuilderScenario('compress-explicit-new-session');

    const delegation = [
      '## Goal',
      'Add dark mode toggle',
      '## Session Management',
      '// data:agent.compress_context=new_session',
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

  test('missing Session Management section → defaults to new_session for unrelated delegation', async () => {
    const scenario = await setupPlannerBuilderScenario('compress-default-new-session');

    const delegation = [
      '## Goal',
      'Implement unrelated payments API',
      '## Files to implement',
      '- `src/payments.ts`',
    ].join('\n');

    await scenario.handoff('planner', 'builder', delegation);

    const builderTaskId = await scenario.pendingTaskFor('builder');
    const taskContent = await scenario.taskContent(builderTaskId);
    expect(taskContent).not.toContain('Session Management');
    expectNewSessionFromTaskContent(taskContent);

    const injection = await scenario.nativeInjectionPromptFor(
      'builder',
      builderTaskId,
      taskContent
    );
    assertNativeInjectionCompaction(injection, 'new_session');
  });

  test('compress_context=none → builder continues prior session (no compaction header)', async () => {
    const scenario = await setupPlannerBuilderScenario('compress-continue-session');

    const delegation = [
      '## Goal',
      'Small follow-up on same slice',
      '## Session Management',
      '// data:agent.compress_context=none',
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
