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
  currentContext: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
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
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: null,
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
    // Entry point should have context creation step
    expect(output).toContain('Code changes expected?');
    // User message should trigger classification flow
    expect(output).toContain('Classify');
    expect(output).toContain('targets: builder, user');
    // Phase Planning Loop should appear for planner receiving a user message
    expect(output).toContain('**Phase Planning Loop:**');
    expect(output).toContain('```mermaid');
    expect(output).toContain('flowchart TD');
    expect(output).toContain('[Classify and understand the task]');
    expect(output).toContain('[Break task into phases]');
    expect(output).toContain('[Delegate ONE phase to builder]');
    expect(output).toContain("[Review builder's work]");
    expect(output).toContain('[Deliver final result to user]');
    // Step 3 should be delegate to builder, not generic "hand off"
    expect(output).toContain('3. Delegate phase 1 to builder:');
    expect(output).toContain('--next-role=builder');
    // Generic "Do the work → follow PROCESS above" step should NOT appear in next-steps for planner
    // (planner gets Phase Planning Loop instead)
    expect(output).not.toContain('Do the work → follow PROCESS above');
  });

  test('task from team member', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'builder',
        content: 'Implementation complete. All tests pass.',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
    // Team handoff should show "handed off from" instead of classification
    expect(output).toContain('handed off from builder');
    expect(output).not.toContain('Classify →');
    expect(output).toContain('targets: builder, user');
    // Phase Planning Loop should NOT appear for planner receiving a handoff (not a user message)
    expect(output).not.toContain('**Phase Planning Loop:**');
    expect(output).not.toContain(':Delegate ONE phase to builder;');
  });
});
