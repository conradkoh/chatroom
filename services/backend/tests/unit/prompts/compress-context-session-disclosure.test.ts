/**
 * Session augmentation disclosure — unit tests.
 *
 * Builder always starts a fresh session per delegation. The planner→builder
 * brief no longer includes a ## Session Augmentation section.
 */

import { describe, expect, test } from 'vitest';

import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import { getPlannerToBuilderHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-builder';
import { resolveSessionAugmentationForTask } from '../../../src/domain/handoff/parse-session-augmentation';

describe('Delegation brief template — no Session Augmentation section', () => {
  test('planner → builder brief does not include Session Augmentation section', () => {
    const brief = getPlannerToBuilderHandoffTemplate();
    expect(brief).not.toContain('## Session Augmentation');
    expect(brief).not.toContain('session_augmentation');
  });
});

describe('Native task delivery — no Session Augmentation in brief', () => {
  test('duo planner delivery does not contain Session Augmentation section', () => {
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
    expect(output).not.toContain('## Session Augmentation');
    expect(output).not.toContain('data:agent.session_augmentation');
  });
});

describe('resolveSessionAugmentationForTask — builder always new_session', () => {
  test('builder task with no augmentation section resolves to new_session', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nImplement feature', startInNewSession: undefined },
        'builder'
      )
    ).toBe('new_session');
  });

  test('builder task with explicit none tag resolves to new_session', () => {
    expect(
      resolveSessionAugmentationForTask(
        '## Goal\nFollow-up\n## Session Augmentation\n// data:agent.session_augmentation=none',
        'builder'
      )
    ).toBe('new_session');
  });
});
