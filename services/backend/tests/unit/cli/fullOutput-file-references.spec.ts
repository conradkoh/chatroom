/**
 * Unit tests for generateFullCliOutput — file reference hints rendering.
 *
 * When task content, message content, or origin message content contains
 * `{file://...}` tokens, the output should include a "File References" section
 * with `chatroom file view` commands for each unique reference.
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

describe('generateFullCliOutput — file reference hints', () => {
  test('does not render File References section when no file refs in content', () => {
    const output = generateFullCliOutput(baseParams());
    expect(output).not.toContain('## File References');
    expect(output).not.toContain('chatroom file view');
  });

  test('renders File References section when task content has file refs', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: 'Please review {file://ws123/src/index.ts} for issues',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain('This task references workspace files. To view them:');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/index.ts}"`
    );
  });

  test('renders File References section when message content has file refs', () => {
    const params = {
      ...baseParams(),
      message: {
        _id: 'msg-id-456',
        senderRole: 'user',
        content: 'Look at {file://ws123/src/utils.ts} please',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/utils.ts}"`
    );
  });

  test('renders File References section when origin message content has file refs', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Check {file://ws123/README.md} for context',
        classification: null,
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/README.md}"`
    );
  });

  test('deduplicates file refs across all sources', () => {
    const ref = '{file://ws123/src/shared.ts}';
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: `See ${ref} for the shared module`,
      },
      message: {
        _id: 'msg-id-456',
        senderRole: 'user',
        content: `Also check ${ref} here`,
      },
      originMessage: {
        senderRole: 'user',
        content: `Original request about ${ref}`,
        classification: null,
      },
    };
    const output = generateFullCliOutput(params);

    // Count occurrences of the file view command for this ref
    const viewCmd = `chatroom file view --file-reference="${ref}"`;
    const matches = output.match(new RegExp(viewCmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    expect(matches).toHaveLength(1);
  });

  test('renders multiple unique file refs', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content:
          'Compare {file://ws123/src/old.ts} with {file://ws123/src/new.ts} and {file://ws456/lib/helper.ts}',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/old.ts}"`
    );
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/new.ts}"`
    );
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws456/lib/helper.ts}"`
    );
  });

  test('skips escaped file refs (preceded by backslash)', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content:
          'This is escaped \\{file://ws123/src/skip.ts} but {file://ws123/src/keep.ts} is not',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/keep.ts}"`
    );
    expect(output).not.toContain('file-reference="{file://ws123/src/skip.ts}"');
  });

  test('limits file refs to 10', () => {
    const refs = Array.from({ length: 15 }, (_, i) => `{file://ws123/src/file${i}.ts}`);
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: refs.join(' '),
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');

    // First 10 should be present
    for (let i = 0; i < 10; i++) {
      expect(output).toContain(`file-reference="{file://ws123/src/file${i}.ts}"`);
    }
    // 11th through 14th should NOT be present
    for (let i = 10; i < 15; i++) {
      expect(output).not.toContain(`file-reference="{file://ws123/src/file${i}.ts}"`);
    }
  });

  test('aggregates refs from task, message, and origin message', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: 'See {file://ws1/a.ts}',
      },
      message: {
        _id: 'msg-id-456',
        senderRole: 'builder',
        content: 'Implemented changes in {file://ws2/b.ts}',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Started from {file://ws3/c.ts}',
        classification: null,
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(`file-reference="{file://ws1/a.ts}"`);
    expect(output).toContain(`file-reference="{file://ws2/b.ts}"`);
    expect(output).toContain(`file-reference="{file://ws3/c.ts}"`);
  });

  test('handles null message and origin message gracefully', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: 'Review {file://ws123/src/component.tsx}',
      },
      message: null,
      originMessage: null,
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `${CLI_ENV_PREFIX}chatroom file view --file-reference="{file://ws123/src/component.tsx}"`
    );
  });

  test('does not render section for text containing "file://" but not in {file://} format', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: 'Use the file:// protocol for local files',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).not.toContain('## File References');
  });

  test('handles file refs with complex paths including dots, dashes, and nested dirs', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content:
          'Check {file://ws-abc_123/src/components/ui/my-component.test.tsx} and {file://ws456/packages/@scope/lib/index.d.ts}',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(
      `file-reference="{file://ws-abc_123/src/components/ui/my-component.test.tsx}"`
    );
    expect(output).toContain(`file-reference="{file://ws456/packages/@scope/lib/index.d.ts}"`);
  });

  test('file ref at the very start of text is not escaped', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: '{file://ws123/first.ts} is the entry point',
      },
    };
    const output = generateFullCliOutput(params);

    expect(output).toContain('## File References');
    expect(output).toContain(`file-reference="{file://ws123/first.ts}"`);
  });

  test('deduplication preserves first-seen order', () => {
    const params = {
      ...baseParams(),
      task: {
        _id: 'task-id-123',
        content: '{file://ws/b.ts} then {file://ws/a.ts} then {file://ws/b.ts} again',
      },
    };
    const output = generateFullCliOutput(params);

    const bIdx = output.indexOf('file-reference="{file://ws/b.ts}"');
    const aIdx = output.indexOf('file-reference="{file://ws/a.ts}"');
    expect(bIdx).toBeLessThan(aIdx); // b appears first since it was seen first
  });
});
