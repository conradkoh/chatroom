/**
 * Unit tests for generateFullCliOutput — attached backlog items in primary delivery.
 *
 * Backlog items attached via "Attach to Context" must appear in the primary task
 * delivery output as XML inside <attachments>, alongside the user's message content.
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
      content: 'Can you work on this item',
    },
    message: {
      _id: 'msg-id-456',
      senderRole: 'user',
      content: 'Can you work on this item',
    },
    currentContext: null,
    originMessage: null,
    followUpCountSinceOrigin: 0,
    originMessageCreatedAt: null,
    isEntryPoint: true,
    availableHandoffTargets: ['builder', 'user'],
  };
}

describe('generateFullCliOutput — backlog items in primary delivery', () => {
  test('renders backlog XML from sourceAttachments after task content', () => {
    const output = generateFullCliOutput({
      ...baseParams(),
      sourceAttachments: {
        attachedBacklogItems: [
          {
            _id: 'backlog-item-id-001',
            status: 'backlog',
            content: 'Implement dark mode toggle component',
          },
        ],
      },
    });

    const taskContentIdx = output.indexOf('Can you work on this item');
    const attachmentsIdx = output.indexOf('<attachments>');
    expect(attachmentsIdx).toBeGreaterThan(taskContentIdx);
    expect(output).toContain('type="backlog"');
    expect(output).toContain('backlog-item-id="backlog-item-id-001"');
    expect(output).toContain('mark-for-review');
  });

  test('renders task XML from sourceAttachments after task content', () => {
    const output = generateFullCliOutput({
      ...baseParams(),
      sourceAttachments: {
        attachedTasks: [
          {
            _id: 'attached-task-id-001',
            status: 'backlog',
            content: 'Prior work item for context',
          },
        ],
      },
    });

    const taskContentIdx = output.indexOf('Can you work on this item');
    const attachmentsIdx = output.indexOf('<attachments>');
    expect(attachmentsIdx).toBeGreaterThan(taskContentIdx);
    expect(output).toContain('type="task"');
    expect(output).toContain('Prior work item for context');
    expect(output).toContain('attached-task-id-001');
  });

  test('omits attachments block when no sourceAttachments', () => {
    const output = generateFullCliOutput(baseParams());
    expect(output).not.toContain('<attachments>');
    expect(output).not.toContain('type="backlog"');
  });

  test('does not render legacy attachedTasks from originMessage alone', () => {
    const params = {
      ...baseParams(),
      originMessage: {
        senderRole: 'user',
        content: 'Fix things',
        classification: null,
        attachedTasks: [{ _id: 'legacy-task', status: 'backlog', content: 'Legacy task item' }],
      },
    };

    const output = generateFullCliOutput(params);
    expect(output).not.toContain('Legacy task item');
    expect(output).not.toContain('type="task"');
  });

  test('renders message attachments in unified attachments block', () => {
    const output = generateFullCliOutput({
      ...baseParams(),
      sourceAttachments: {
        attachedMessages: [
          {
            _id: 'msg-id-attached',
            content: 'Some context message',
            senderRole: 'builder',
          },
        ],
      },
    });

    expect(output).toContain('<attachments>');
    expect(output).toContain('type="message" message-id="msg-id-attached"');
    expect(output).toContain('Some context message');
    expect(output).not.toContain('<attached-message>');
  });
});

describe('generateFullCliOutput — task content is inline', () => {
  test('includes task content in output', () => {
    const params = baseParams();
    const output = generateFullCliOutput(params);

    expect(output).toContain(params.task.content);
    expect(output).toContain('harness output (stdout tokens)');
    expect(output).not.toMatch(/task read --chatroom-id/i);
  });

  test('next steps start with work on the task above', () => {
    const params = baseParams();
    const output = generateFullCliOutput(params);

    expect(output).toContain('1. Work on the task above.');
    expect(output).not.toContain('chatroom task read');
  });
});
