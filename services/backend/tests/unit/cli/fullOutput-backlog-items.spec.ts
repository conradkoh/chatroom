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
          {
            _id: 'backlog-item-id-001',
            status: 'backlog',
            content: 'Implement dark mode toggle component',
          },
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
          { _id: 'backlog-item-id-001', status: 'backlog', content: 'Item A' },
          {
            _id: 'backlog-item-id-002',
            status: 'pending_user_review',
            content: 'Item B under review',
          },
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
        attachedBacklogItems: [
          { _id: 'backlog-item-id-001', status: 'backlog', content: 'New backlog item' },
        ],
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
        attachedBacklogItems: [
          {
            _id: 'backlog-item-id-001',
            status: 'pending_user_review',
            content: 'Review this item',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('[PENDING_USER_REVIEW]');
    // Should NOT contain lowercase status
    expect(output).not.toContain('[pending_user_review]');
  });
});

describe('generateFullCliOutput — backlog item tags and guidance', () => {
  test('wraps each backlog item in <backlog-item> tags', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
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

    expect(output).toContain('<backlog-item>');
    expect(output).toContain('</backlog-item>');
  });

  test('includes item ID in each backlog item block', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
        classification: null,
        attachedBacklogItems: [
          {
            _id: 'qn78yc33r4zfp7v7z153qa3rwn837cp7',
            status: 'backlog',
            content: 'Implement dark mode toggle component',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain('ID: qn78yc33r4zfp7v7z153qa3rwn837cp7');
  });

  test('renders <system-info> section with mark-for-review hint after backlog items', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
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

    expect(output).toContain('<system-info>');
    expect(output).toContain('</system-info>');
    expect(output).toContain('mark-for-review');
    expect(output).toContain('--backlog-item-id=');
  });

  test('system-info hint includes correct env prefix and chatroom ID', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
        classification: null,
        attachedBacklogItems: [
          {
            _id: 'backlog-item-id-001',
            status: 'backlog',
            content: 'Implement feature X',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain(CLI_ENV_PREFIX);
    expect(output).toContain(`--chatroom-id="${CHATROOM_ID}"`);
  });

  test('system-info hint includes role parameter', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on this',
        classification: null,
        attachedBacklogItems: [
          {
            _id: 'backlog-item-id-001',
            status: 'backlog',
            content: 'Implement feature X',
          },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    expect(output).toContain(`--role="${ROLE}"`);
  });

  test('does not render system-info when no backlog items attached', () => {
    const output = generateFullCliOutput(baseParams());

    expect(output).not.toContain('<system-info>');
  });

  test('wraps multiple backlog items each in their own <backlog-item> tags', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Work on these',
        classification: null,
        attachedBacklogItems: [
          { _id: 'id-aaa', status: 'backlog', content: 'Item A' },
          { _id: 'id-bbb', status: 'backlog', content: 'Item B' },
        ],
      },
    };

    const output = generateFullCliOutput(params);

    // Should have 2 opening and 2 closing tags
    const openTags = (output.match(/<backlog-item>/g) || []).length;
    const closeTags = (output.match(/<\/backlog-item>/g) || []).length;
    expect(openTags).toBe(2);
    expect(closeTags).toBe(2);

    expect(output).toContain('ID: id-aaa');
    expect(output).toContain('ID: id-bbb');
  });

  test('legacy attachedTasks do not get <backlog-item> tags (no ID available)', () => {
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

    // Legacy tasks should still render in the section but without <backlog-item> tags
    expect(output).toContain('- [BACKLOG] Legacy task item');
    expect(output).not.toContain('<backlog-item>');
    expect(output).not.toContain('<system-info>');
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
