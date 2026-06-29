/**
 * Session augmentation disclosure — unit tests.
 *
 * Documents how planner → builder handoffs control builder context:
 * - Delegation brief template includes Session Augmentation (default new_session)
 * - parseSessionAugmentation defaults when planner omits the section
 * - Native delivery inlines the native-integration variant of the brief
 */

import { describe, expect, test } from 'vitest';

import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import { getPlannerToBuilderHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-builder';
import { buildNativeInjectionPrompt } from '../../helpers/chatroom-scenario';
import {
  assertNativeInjectionCompaction,
  expectContinueSessionFromTaskContent,
  expectNewSessionFromTaskContent,
} from '../../helpers/session-augmentation';

describe('Delegation brief template — Session Augmentation default', () => {
  test('planner → builder brief includes new_session as the documented default', () => {
    const brief = getPlannerToBuilderHandoffTemplate();
    expect(brief).toContain('## Session Augmentation');
    expect(brief).toContain('`none` | `compact` | `new_session`');
    expect(brief).toContain('`new_session` — start a completely new session (default)');
    expect(brief).toContain('// data:agent.session_augmentation=new_session');
  });

  test('nativeIntegration variant explains compact vs new_session without conflating them', () => {
    const nativeBrief = getPlannerToBuilderHandoffTemplate(true);
    expect(nativeBrief).toContain('`compact` runs in-session context compaction');
    expect(nativeBrief).toContain('`new_session` starts a completely new session');
    expect(nativeBrief).toContain('(not compaction)');
    expect(nativeBrief).toContain('Tasks continue via injection');
    expect(nativeBrief).not.toContain('get-next-task rejoin');
  });
});

describe('Native task delivery — planner sees Session Augmentation in eager builder template', () => {
  test('duo planner delivery inlines delegation brief with Session Augmentation', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'PREFIX ',
      task: { _id: 't1', content: 'Plan feature X' },
      message: { _id: 'm1', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
    });

    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('## Session Augmentation');
    expect(output).toContain('data:agent.session_augmentation=new_session');
    expect(
      getHandoffTemplate({
        teamId: 'duo',
        fromRole: 'planner',
        toRole: 'builder',
        nativeIntegration: true,
      })
    ).toBe(getPlannerToBuilderHandoffTemplate(true));
  });
});

describe('parseSessionAugmentation — planner handoff body → daemon behavior', () => {
  test('omitted Session Augmentation section defaults to new_session (unrelated task)', () => {
    expectNewSessionFromTaskContent(
      ['## Goal', 'Implement dark mode toggle', '## Files to implement'].join('\n')
    );
  });

  test('explicit none continues prior builder session', () => {
    expectContinueSessionFromTaskContent(`## Goal
Follow-up fix on same slice
## Session Augmentation
// data:agent.session_augmentation=none`);
  });

  test('injection prompt adds correct preamble per mode', () => {
    const delivery = '<task>builder work</task>';
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent:
          '## Goal\nUnrelated feature\n## Session Augmentation\n// data:agent.session_augmentation=new_session',
      }),
      'new_session'
    );
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent:
          '## Goal\nCompact context\n## Session Augmentation\n// data:agent.session_augmentation=compact',
      }),
      'compact'
    );
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent:
          '## Goal\nFollow-up\n## Session Augmentation\n// data:agent.session_augmentation=none',
      }),
      'none'
    );
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent: '## Goal\nUnrelated feature with no session section',
      }),
      'new_session'
    );
  });
});
