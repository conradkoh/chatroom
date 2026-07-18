import { describe, expect, test } from 'vitest';

import { renderTaskEnvelopeLines } from './render-task-envelope';

const BASE_PARAMS = {
  chatroomId: 'room-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  isEntryPoint: false,
  currentContext: null,
  originMessage: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  deliveryMode: 'cli' as const,
};

describe('renderTaskEnvelopeLines', () => {
  test('renders task-id attribute when message is null', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-001', content: 'Do the work' },
      message: null,
    });
    const openTag = lines[0];
    expect(openTag).toContain('task-id="task-001"');
    expect(openTag).not.toContain('origin-message-id');
    expect(openTag).not.toContain('sender=');
  });

  test('renders origin-message-id and sender attributes when message exists', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-002', content: 'Fix the bug' },
      message: { _id: 'msg-001', senderRole: 'user' },
    });
    const openTag = lines[0];
    expect(openTag).toContain('task-id="task-002"');
    expect(openTag).toContain('origin-message-id="msg-001"');
    expect(openTag).toContain('sender="user"');
  });

  test('renders message block with sender, message-id, and content', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-003', content: 'Implement feature' },
      message: { _id: 'msg-002', senderRole: 'planner' },
    });
    const output = lines.join('\n');
    expect(output).toContain('<message sender="planner" message-id="msg-002">');
    expect(output).toContain('<message-content>');
    expect(output).toContain('Implement feature');
    expect(output).toContain('</message-content>');
    expect(output).toContain('</message>');
  });

  test('escapes XML special characters in content', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-004', content: 'Use <b>bold</b> & "quotes"' },
      message: { _id: 'msg-003', senderRole: 'user' },
    });
    const output = lines.join('\n');
    expect(output).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(output).toContain('&amp;');
    // Double quotes in text content are valid XML and do not need escaping
    expect(output).toContain('"quotes"');
  });

  test('attachments appear before message block when attachments exist', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-005', content: 'Main content' },
      message: { _id: 'msg-004', senderRole: 'user' },
      sourceAttachments: {
        attachedBacklogItems: [
          { _id: 'bl-001', status: 'backlog', content: 'Backlog item content' },
        ],
      },
    });
    const output = lines.join('\n');
    expect(output.indexOf('<attachments>')).toBeLessThan(output.indexOf('<message sender='));
    expect(output.indexOf('<message-content>')).toBeGreaterThan(output.indexOf('</attachments>'));
  });

  test('standing instructions appear above attachments and escape XML', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-005b', content: 'Main content' },
      message: { _id: 'msg-004b', senderRole: 'user' },
      standingInstructions: 'Prefer <strict> mode & tests',
      sourceAttachments: {
        attachedBacklogItems: [
          { _id: 'bl-001', status: 'backlog', content: 'Backlog item content' },
        ],
      },
    });
    const output = lines.join('\n');
    expect(output).toContain('<standing-instructions>');
    expect(output).toContain('Prefer &lt;strict&gt; mode &amp; tests');
    expect(output.indexOf('<standing-instructions>')).toBeLessThan(output.indexOf('<attachments>'));
    expect(output.indexOf('</standing-instructions>')).toBeLessThan(
      output.indexOf('<attachments>')
    );
    expect(output.indexOf('<attachments>')).toBeLessThan(output.indexOf('<message sender='));
  });

  test('includes intake note when provided', () => {
    const lines = renderTaskEnvelopeLines({
      ...BASE_PARAMS,
      task: { _id: 'task-006', content: 'Do work' },
      message: { _id: 'msg-005', senderRole: 'user' },
      intakeNote: 'Begin working from the task content above.',
    });
    const output = lines.join('\n');
    expect(output).toContain('<intake-note>');
    expect(output).toContain('Begin working from the task content above.');
    expect(output).toContain('</intake-note>');
  });
});
