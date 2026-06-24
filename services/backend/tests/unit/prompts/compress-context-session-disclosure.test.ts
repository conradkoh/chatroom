/**
 * Session management disclosure — unit tests.
 *
 * Documents how planner → builder handoffs control builder context:
 * - Delegation brief template includes Session Management (default new_session)
 * - parseCompressContext defaults when planner omits the section
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
} from '../../helpers/compress-context-session';

describe('Delegation brief template — Session Management default', () => {
  test('planner → builder brief includes new_session as the documented default', () => {
    const brief = getPlannerToBuilderHandoffTemplate();
    expect(brief).toContain('## Session Management');
    expect(brief).toContain('`new_session` — start a fresh agent session (default)');
    expect(brief).toContain('// data:agent.compress_context=new_session');
  });

  test('nativeIntegration variant explains in-process compaction for SDK harnesses', () => {
    const nativeBrief = getPlannerToBuilderHandoffTemplate(true);
    expect(nativeBrief).toContain('in-session context compaction is supported');
    expect(nativeBrief).toContain('tasks continue via injection');
    expect(nativeBrief).not.toContain('get-next-task rejoin');
  });
});

describe('Native task delivery — planner sees Session Management in eager builder template', () => {
  test('duo planner delivery inlines delegation brief with Session Management', () => {
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
    expect(output).toContain('## Session Management');
    expect(output).toContain('data:agent.compress_context=new_session');
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

describe('parseCompressContext — planner handoff body → daemon behavior', () => {
  test('omitted Session Management section defaults to new_session (unrelated task)', () => {
    expectNewSessionFromTaskContent(
      ['## Goal', 'Implement dark mode toggle', '## Files to implement'].join('\n')
    );
  });

  test('explicit none continues prior builder session', () => {
    expectContinueSessionFromTaskContent(`## Goal
Follow-up fix on same slice
## Session Management
// data:agent.compress_context=none`);
  });

  test('injection prompt adds compaction header only for new_session', () => {
    const delivery = '<task>builder work</task>';
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent:
          '## Goal\nUnrelated feature\n## Session Management\n// data:agent.compress_context=new_session',
      }),
      'new_session'
    );
    assertNativeInjectionCompaction(
      buildNativeInjectionPrompt({
        taskDeliveryOutput: delivery,
        taskContent:
          '## Goal\nFollow-up\n## Session Management\n// data:agent.compress_context=none',
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
