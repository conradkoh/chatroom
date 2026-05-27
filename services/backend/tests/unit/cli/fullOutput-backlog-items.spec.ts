/**
 * Unit tests for generateFullCliOutput — attached backlog items rendering.
 *
 * Backlog items attached via "Attach to Context" (stored as attachedBacklogItemIds
 * on chatroom_messages) are now rendered in the task-read CLI output, NOT in the
 * get-next-task output. This test file verifies that backlog items are correctly
 * excluded from generateFullCliOutput.
 *
 * The rendering was moved from get-next-task → task-read so that backlog items
 * appear as XML <attachments> inside the user message, making them clearer to agents.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../prompts/cli/get-next-task/fullOutput';

const CHATROOM_ID = 'test-chatroom-id';
const ROLE = 'planner';
const CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

/** Minimal valid params for generateFullCliOutput */
function baseParams() {
  return {
    chatroomId: CHATROOM_ID,
    role: ROLE,
    cliEnvPrefix: CLI_ENV_PREFIX,
    task: {
      _id: 'task-id-123',
      content: 'Fix the dark mode toggle',
    },
    message: {
      _id: 'msg-id-456',
      senderRole: 'user',
      content: 'Fix the dark mode toggle',
    },
    currentContext: null,
    originMessage: null,
    followUpCountSinceOrigin: 0,
    originMessageCreatedAt: null,
    isEntryPoint: true,
    availableHandoffTargets: ['builder', 'user'],
  };
}

describe('generateFullCliOutput — backlog items excluded (moved to task-read)', () => {
  test('does not render Attached Backlog section when no attachments', () => {
    const output = generateFullCliOutput(baseParams());
    expect(output).not.toContain('## Attached Backlog');
    expect(output).not.toContain('<backlog-item>');
    expect(output).not.toContain('<system-info>');
  });

  test('does not render backlog items even when attachedBacklogItems are present in originMessage', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix the dark mode toggle',
        classification: null,
        attachedBacklogItems: [
          {
            _id: 'backlog-item-id-001',
            status: 'backlog',
            content: 'Implement dark mode toggle component',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    // Backlog items should NOT appear in get-next-task output (moved to task-read)
    expect(output).not.toContain('## Attached Backlog');
    expect(output).not.toContain('<backlog-item>');
    expect(output).not.toContain('Implement dark mode toggle component');
    expect(output).not.toContain('backlog-item-id-001');
    expect(output).not.toContain('<system-info>');
    expect(output).not.toContain('mark-for-review');
  });

  test('does not render legacy attachedTasks in fullOutput', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [{ status: 'backlog', content: 'Legacy task item' }],
      },
    };

    const output = generateFullCliOutput(params);

    // Legacy tasks should also not appear (moved to task-read)
    expect(output).not.toContain('## Attached Backlog');
    expect(output).not.toContain('Legacy task item');
  });

  test('does not render mixed attachedTasks and attachedBacklogItems', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [{ status: 'backlog', content: 'Legacy task item' }],
        attachedBacklogItems: [
          { _id: 'backlog-item-id-001', status: 'backlog', content: 'New backlog item' },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).not.toContain('## Attached Backlog');
    expect(output).not.toContain('Legacy task item');
    expect(output).not.toContain('New backlog item');
  });

  test('still renders attached messages (not affected by backlog change)', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedMessages: [
          {
            _id: 'msg-id-attached',
            content: 'Some context message',
            senderRole: 'builder',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    // Attached messages should still render in fullOutput
    expect(output).toContain('## Attached Messages (1)');
    expect(output).toContain('<attached-message>');
    expect(output).toContain('Some context message');
  });
});

describe('generateFullCliOutput — task content is hidden', () => {
  test('does not include task content in output', () => {
    const params = baseParams();
    const output = generateFullCliOutput(params);

    // The task content must NOT appear in the CLI output
    // Agents must use `task read` to fetch it
    expect(output).not.toContain(params.task.content);
  });

  test('does not include message content in output', () => {
    const params = {
      ...baseParams(),
      message: {
        _id: 'msg-id-456',
        senderRole: 'user',
        content: 'Add a new feature with secret implementation details',
      },
    };
    const output = generateFullCliOutput(params);

    // Message content must NOT appear in CLI output
    expect(output).not.toContain('Add a new feature with secret implementation details');
  });

  test('includes task read command with task ID', () => {
    const params = baseParams();
    const output = generateFullCliOutput(params);

    // Must show how to fetch the task content
    expect(output).toContain('chatroom task read');
    expect(output).toContain(params.task._id);
  });

  test('includes task read command for handoff messages', () => {
    const params = {
      ...baseParams(),
      message: {
        _id: 'msg-id-789',
        senderRole: 'builder',
        content: 'Completed implementation of the feature. Changes: ...',
      },
    };
    const output = generateFullCliOutput(params);

    // Even for handoffs, content must be hidden and task read must be shown
    expect(output).not.toContain('Completed implementation of the feature');
    expect(output).toContain('chatroom task read');
    expect(output).toContain(params.task._id);
  });
});
