import { describe, expect, test } from 'vitest';

import {
  DELIVERY_ATTACHMENT_RENDERERS,
  renderDeliveryAttachmentsBlock,
} from './render-delivery-attachments.js';
import { MESSAGE_ATTACHMENT_KINDS } from '../../src/domain/entities/message-attachments.js';

test('every MESSAGE_ATTACHMENT_KIND has a renderer entry', () => {
  expect(Object.keys(DELIVERY_ATTACHMENT_RENDERERS).sort()).toEqual(
    [...MESSAGE_ATTACHMENT_KINDS].sort()
  );
});

test('snippet XML matches task-read convention', () => {
  const lines = renderDeliveryAttachmentsBlock(
    {
      attachedSnippets: [
        {
          reference: 'attachment-reference-001',
          fileSource: './windsurfrules',
          selectedContent: '# Shadcn',
        },
      ],
    },
    { chatroomId: 'room', role: 'builder' }
  );
  const block = lines.join('\n');
  expect(block).toContain('<attachment type="snippet" reference="attachment-reference-001">');
  expect(block).toContain('file-source="./windsurfrules"');
  expect(block).toContain('# Shadcn');
  expect(block).toContain('<attachments>');
});

test('returns empty array when no attachments', () => {
  expect(renderDeliveryAttachmentsBlock({}, { chatroomId: 'r', role: 'b' })).toEqual([]);
});

describe('backlog attachment hint', () => {
  test('conveys that the task must be worked on', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'Add login page', status: 'pending' }],
      },
      { chatroomId: 'test-chatroom-456', role: 'planner' }
    );
    const block = lines.join('\n');
    const hintSection = block.slice(block.indexOf('<attachment'), block.indexOf('</attachment>'));
    expect(hintSection).toMatch(/work on|act on/i);
  });

  test('includes backlog-item-id attribute and mark-for-review command', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'Add login page', status: 'pending' }],
      },
      { chatroomId: 'test-chatroom-456', role: 'planner' }
    );
    const block = lines.join('\n');
    expect(block).toContain('type="backlog" backlog-item-id="item-111"');
    expect(block).toContain('<content>Add login page</content>');
    expect(block).not.toMatch(/\[PENDING\]|\[BACKLOG\]/);
    expect(block).toContain('mark-for-review');
    expect(block).toContain(
      'chatroom backlog mark-for-review --chatroom-id="test-chatroom-456" --role="planner" --backlog-item-id=item-111'
    );
  });

  test('escapes XML-special characters in backlog content', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'foo & bar <baz>', status: 'pending' }],
      },
      { chatroomId: 'test-chatroom-456', role: 'planner' }
    );
    const block = lines.join('\n');
    expect(block).toContain('<content>foo &amp; bar &lt;baz&gt;</content>');
  });
});

describe('snippet attachments', () => {
  test('renders snippet XML in attachments block', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: './windsurfrules',
            selectedContent: '# Shadcn',
          },
        ],
      },
      { chatroomId: 'test-chatroom-000', role: 'builder' }
    );
    const block = lines.join('\n');
    expect(block).toContain('<attachments>');
    expect(block).toContain('<attachment type="snippet" reference="attachment-reference-001">');
    expect(block).toContain('file-source="./windsurfrules"');
    expect(block).toContain('# Shadcn');
    expect(block).not.toContain('type="message"');
  });

  test('renders backlog and snippet attachments in same block', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'Backlog task', status: 'pending' }],
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: 'src/foo.ts',
            selectedContent: 'const x = 1;',
          },
        ],
      },
      { chatroomId: 'test-chatroom-000', role: 'builder' }
    );
    const block = lines.join('\n');
    expect(block).toContain('<attachments>');
    expect(block).toContain('type="backlog" backlog-item-id="item-111"');
    expect(block).toContain('<attachment type="snippet" reference="attachment-reference-001">');
    expect(block).toContain('file-source="src/foo.ts"');
    expect(block.match(/<attachments>/g)?.length).toBe(1);
    expect(block.match(/<\/attachments>/g)?.length).toBe(1);
  });
});

describe('task attachments', () => {
  test('renders task XML with task-id attribute', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedTasks: [{ _id: 'task-abc123', content: 'Fix login redirect', status: 'backlog' }],
      },
      { chatroomId: 'test-chatroom-000', role: 'builder' }
    );
    const block = lines.join('\n');
    expect(block).toContain('<attachments>');
    expect(block).toContain('type="task" task-id="task-abc123"');
    expect(block).toContain('<content>Fix login redirect</content>');
    expect(block).not.toMatch(/\[BACKLOG\]/);
    expect(block).toContain('Referenced task attached by user');
  });
});

describe('message attachments', () => {
  test('renders message XML with message-id attribute', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedMessages: [
          { _id: 'msg-abc123', content: 'Some context message', senderRole: 'builder' },
        ],
      },
      { chatroomId: 'test-chatroom-000', role: 'builder' }
    );
    const block = lines.join('\n');
    expect(block).toContain('<attachments>');
    expect(block).toContain('type="message" message-id="msg-abc123"');
    expect(block).toContain('<sender-role>builder</sender-role>');
    expect(block).toContain('<content>Some context message</content>');
    expect(block).not.toContain('From: builder');
  });

  test('renders all attachment kinds in one block', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'Backlog task', status: 'pending' }],
        attachedTasks: [{ _id: 'task-222', content: 'Prior task', status: 'completed' }],
        attachedMessages: [{ _id: 'msg-333', content: 'Context', senderRole: 'user' }],
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: 'src/foo.ts',
            selectedContent: 'const x = 1;',
          },
        ],
      },
      { chatroomId: 'test-chatroom-000', role: 'builder' }
    );
    const block = lines.join('\n');
    expect(block).toContain('type="backlog" backlog-item-id="item-111"');
    expect(block).toContain('type="task" task-id="task-222"');
    expect(block).toContain('type="message" message-id="msg-333"');
    expect(block).toContain('type="snippet" reference="attachment-reference-001"');
    expect(block.match(/<attachments>/g)?.length).toBe(1);
  });
});
