/**
 * Unit tests for generateFullCliOutput — attached backlog items rendering.
 *
 * Verifies that backlog items attached via "Attach to Context"
 * (stored as attachedBacklogItemIds on chatroom_messages) are correctly
 * rendered in the ## Attached Backlog section of the CLI task delivery output.
 *
 * Bug fixed: bb701b29 — previously attachedBacklogItems was not passed to
 * generateFullCliOutput, so backlog items were silently dropped from the output.
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

describe('generateFullCliOutput — attached backlog items', () => {
  test('renders nothing in Attached Backlog when no attachments', () => {
    const output = generateFullCliOutput(baseParams());

    expect(output).not.toContain('## Attached Backlog');
  });

  test('renders backlog items from attachedBacklogItems in ## Attached Backlog section', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix the dark mode toggle',
        classification: null,
        attachedBacklogItems: [
          { status: 'backlog', content: 'Implement dark mode toggle component' },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('## Attached Backlog (1)');
    expect(output).toContain('- [BACKLOG] Implement dark mode toggle component');
  });

  test('renders multiple backlog items', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix multiple things',
        classification: null,
        attachedBacklogItems: [
          { status: 'backlog', content: 'Item A' },
          { status: 'pending_user_review', content: 'Item B under review' },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('## Attached Backlog (2)');
    expect(output).toContain('- [BACKLOG] Item A');
    expect(output).toContain('- [PENDING_USER_REVIEW] Item B under review');
  });

  test('merges attachedTasks (chatroom_tasks) and attachedBacklogItems (chatroom_backlog) in same section', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [{ status: 'backlog', content: 'Legacy task item' }],
        attachedBacklogItems: [{ status: 'backlog', content: 'New backlog item' }],
      },
    };

    const output = generateFullCliOutput(params);

    // Both should appear under a single Attached Backlog section (count = 2)
    expect(output).toContain('## Attached Backlog (2)');
    expect(output).toContain('- [BACKLOG] Legacy task item');
    expect(output).toContain('- [BACKLOG] New backlog item');
  });

  test('renders only attachedTasks when no attachedBacklogItems present (backward compat)', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [{ status: 'backlog', content: 'A legacy task' }],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('## Attached Backlog (1)');
    expect(output).toContain('- [BACKLOG] A legacy task');
  });

  test('renders nothing when both arrays are empty', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [],
        attachedBacklogItems: [],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).not.toContain('## Attached Backlog');
  });

  test('status is uppercased in output', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
        classification: null,
        attachedBacklogItems: [{ status: 'pending_user_review', content: 'Review this item' }],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('[PENDING_USER_REVIEW]');
    // Should NOT contain lowercase status
    expect(output).not.toContain('[pending_user_review]');
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
