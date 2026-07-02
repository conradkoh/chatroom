import { describe, expect, test } from 'vitest';

import {
  assemblePrimaryDeliveryAttachments,
  resolvePrimaryDeliveryAssemblyInput,
  type PrimaryDeliveryAssemblyInput,
} from './assemble-primary-delivery-attachments';
import {
  PRIMARY_DELIVERY_ATTACHMENT_KINDS,
  PRIMARY_DELIVERY_INPUT_KEY_BY_KIND,
} from './message-attachments';

const BACKLOG_ITEM = {
  _id: 'backlog-001',
  content: 'Refactor auth helpers',
  status: 'backlog',
};

const SNIPPET = {
  reference: 'attachment-reference-001',
  fileSource: './src/auth.ts',
  selectedContent: 'export function login() {}',
};

const TASK_ITEM = {
  _id: 'task-001',
  content: 'Fix login redirect',
  status: 'backlog',
};

const MESSAGE_ITEM = {
  _id: 'msg-001',
  content: 'Prior discussion thread',
  senderRole: 'builder',
};

describe('assemblePrimaryDeliveryAttachments', () => {
  test('returns undefined when all primary-delivery fields are empty', () => {
    expect(assemblePrimaryDeliveryAttachments({})).toBeUndefined();
    expect(
      assemblePrimaryDeliveryAttachments({
        attachedBacklogItems: [],
        attachedSnippets: [],
        attachedTasks: [],
        attachedMessages: [],
      })
    ).toBeUndefined();
  });

  test('includes every present primary-delivery field', () => {
    const input: PrimaryDeliveryAssemblyInput = {
      attachedBacklogItems: [BACKLOG_ITEM],
      attachedSnippets: [SNIPPET],
      attachedTasks: [TASK_ITEM],
      attachedMessages: [MESSAGE_ITEM],
    };
    const result = assemblePrimaryDeliveryAttachments(input);

    for (const kind of PRIMARY_DELIVERY_ATTACHMENT_KINDS) {
      const key = PRIMARY_DELIVERY_INPUT_KEY_BY_KIND[kind];
      expect(result?.[key]).toEqual(input[key]);
    }
  });
});

describe('resolvePrimaryDeliveryAssemblyInput', () => {
  test('resolves all attachment kinds from source message', () => {
    const backlogMap = new Map([['bl-1', { id: 'bl-1', content: 'Fix login', status: 'backlog' }]]);
    const tasksMap = new Map([
      ['task-1', { id: 'task-1', content: 'Prior task', status: 'completed' }],
    ]);
    const messagesMap = new Map([
      ['msg-1', { id: 'msg-1', content: 'Context message', senderRole: 'user' }],
    ]);

    const input = resolvePrimaryDeliveryAssemblyInput(
      {
        attachedSnippets: [SNIPPET],
        attachedBacklogItemIds: ['bl-1', 'missing-id'],
        attachedTaskIds: ['task-1', 'missing-task'],
        attachedMessageIds: ['msg-1', 'missing-msg'],
      },
      backlogMap,
      tasksMap,
      messagesMap
    );

    expect(input.attachedSnippets).toEqual([SNIPPET]);
    expect(input.attachedBacklogItems).toEqual([
      { _id: 'bl-1', content: 'Fix login', status: 'backlog' },
    ]);
    expect(input.attachedTasks).toEqual([
      { _id: 'task-1', content: 'Prior task', status: 'completed' },
    ]);
    expect(input.attachedMessages).toEqual([
      { _id: 'msg-1', content: 'Context message', senderRole: 'user' },
    ]);
  });

  test('returns empty input when message is null', () => {
    expect(resolvePrimaryDeliveryAssemblyInput(null, new Map(), new Map(), new Map())).toEqual({});
  });
});

describe('resolve → assemble pipeline', () => {
  test('produces primary delivery payload for task renderers', () => {
    const backlogMap = new Map([['bl-1', { id: 'bl-1', content: 'Fix login', status: 'backlog' }]]);
    const tasksMap = new Map([
      ['task-1', { id: 'task-1', content: 'Prior task', status: 'backlog' }],
    ]);
    const messagesMap = new Map([
      ['msg-1', { id: 'msg-1', content: 'Context message', senderRole: 'user' }],
    ]);

    const assembled = assemblePrimaryDeliveryAttachments(
      resolvePrimaryDeliveryAssemblyInput(
        {
          attachedBacklogItemIds: ['bl-1'],
          attachedSnippets: [SNIPPET],
          attachedTaskIds: ['task-1'],
          attachedMessageIds: ['msg-1'],
        },
        backlogMap,
        tasksMap,
        messagesMap
      )
    );

    expect(assembled).toEqual({
      attachedBacklogItems: [{ _id: 'bl-1', content: 'Fix login', status: 'backlog' }],
      attachedSnippets: [SNIPPET],
      attachedTasks: [{ _id: 'task-1', content: 'Prior task', status: 'backlog' }],
      attachedMessages: [{ _id: 'msg-1', content: 'Context message', senderRole: 'user' }],
    });
  });
});
