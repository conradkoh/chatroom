/**
 * Duo Team — Planner Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the planner receives a task
 * via get-next-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/cli/get-next-task/fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'planner',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature as described',
  },
  isEntryPoint: true,
  availableHandoffTargets: ['builder', 'user'],
};

describe('Duo Team > Planner > Get Next Task', () => {
  test('task from user', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('<task task-id=');
    expect(output).toContain('<next-steps>');
    // User message should include inline task content and work-first next steps
    expect(output).toContain('Work on the task above');
    expect(output).toContain('Implement the feature as described');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('--next-role="user"');
    expect(output).not.toContain('Do the work → follow PROCESS above');
    // Eagerly delivered report template (what changed + nested proofs + mermaid system design)
    expect(output).toContain('## What changed');
    expect(output).toContain('## Proof of Principles');
    expect(output).toContain('## Proof of Completion');
    expect(output).toContain('## System Design');
    expect(output).toContain('```mermaid');
  });

  test('includes enhancer guidance when plannerEnhancerEnabled', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('One check-in per builder delegation');
    expect(output).toContain('planner → enhancer → planner → builder');
    expect(output).toContain('You MUST check in with the enhancer');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Run get-next-task immediately');
    expect(output).toContain(
      'user → [loop planner → enhancer → planner → builder → planner] → user'
    );
  });

  test('omits enhancer guidance when plannerEnhancerEnabled is false', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      plannerEnhancerEnabled: false,
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
    });

    expect(output).not.toContain('<handoff-enhancer>');
  });

  test('enhancer disabled user task targets user and omits enhancer template', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      plannerEnhancerEnabled: false,
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
    });

    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Handoff to `builder`');
  });

  test('enhancer feedback task includes review guidance and targets builder', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      plannerEnhancerEnabled: true,
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      message: {
        _id: 'enhancer-message-id',
        senderRole: 'enhancer',
        content: '## Summary\nPlanning feedback',
      },
    });

    expect(output).toContain('<enhancer-review>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="builder"');
  });

  test('task from team member', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'builder',
        content: 'Implementation complete. All tests pass.',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('<task task-id=');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).not.toContain('Classify →');
    expect(output).toContain('<handoffs>');
    // Phase Planning Loop should NOT appear for planner receiving a handoff (not a user message)
    expect(output).not.toContain('**Phase Planning Loop:**');
    expect(output).not.toContain(':Delegate ONE phase to builder;');
  });
});
