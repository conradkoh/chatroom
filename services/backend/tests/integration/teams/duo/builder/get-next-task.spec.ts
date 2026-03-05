/**
 * Duo Team — Builder Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the builder receives a task
 * via get-next-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/cli/get-next-task/fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature as described',
  },
  currentContext: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: false,
  availableHandoffTargets: ['planner'],
};

describe('Duo Team > Builder > Get Next Task', () => {
  test('task from planner', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'planner',
        content: 'Please implement dark mode for the settings page',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 NEXT STEPS');
    // Non-entry point should NOT have context creation step
    expect(output).not.toContain('Code changes expected?');
    expect(output).toContain('targets: planner');
  });
});
