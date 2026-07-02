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

describe('assemblePrimaryDeliveryAttachments', () => {
  test('returns undefined when all primary-delivery fields are empty', () => {
    expect(assemblePrimaryDeliveryAttachments({})).toBeUndefined();
    expect(
      assemblePrimaryDeliveryAttachments({
        attachedBacklogItems: [],
        attachedSnippets: [],
      })
    ).toBeUndefined();
  });

  test('includes backlog only', () => {
    expect(assemblePrimaryDeliveryAttachments({ attachedBacklogItems: [BACKLOG_ITEM] })).toEqual({
      attachedBacklogItems: [BACKLOG_ITEM],
    });
  });

  test('includes snippet only', () => {
    expect(assemblePrimaryDeliveryAttachments({ attachedSnippets: [SNIPPET] })).toEqual({
      attachedSnippets: [SNIPPET],
    });
  });

  test('includes every present primary-delivery field', () => {
    const input: PrimaryDeliveryAssemblyInput = {
      attachedBacklogItems: [BACKLOG_ITEM],
      attachedSnippets: [SNIPPET],
    };
    const result = assemblePrimaryDeliveryAttachments(input);

    for (const kind of PRIMARY_DELIVERY_ATTACHMENT_KINDS) {
      const key = PRIMARY_DELIVERY_INPUT_KEY_BY_KIND[kind];
      expect(result?.[key]).toEqual(input[key]);
    }
  });
});

describe('resolvePrimaryDeliveryAssemblyInput', () => {
  test('resolves snippets and backlog items from source message', () => {
    const backlogMap = new Map([['bl-1', { id: 'bl-1', content: 'Fix login', status: 'backlog' }]]);

    const input = resolvePrimaryDeliveryAssemblyInput(
      {
        attachedSnippets: [SNIPPET],
        attachedBacklogItemIds: ['bl-1', 'missing-id'],
      },
      backlogMap
    );

    expect(input.attachedSnippets).toEqual([SNIPPET]);
    expect(input.attachedBacklogItems).toEqual([
      { _id: 'bl-1', content: 'Fix login', status: 'backlog' },
    ]);
  });

  test('returns empty input when message is null', () => {
    expect(resolvePrimaryDeliveryAssemblyInput(null, new Map())).toEqual({});
  });
});

describe('resolve → assemble pipeline', () => {
  test('produces primary delivery payload for task renderers', () => {
    const backlogMap = new Map([['bl-1', { id: 'bl-1', content: 'Fix login', status: 'backlog' }]]);

    const assembled = assemblePrimaryDeliveryAttachments(
      resolvePrimaryDeliveryAssemblyInput(
        { attachedBacklogItemIds: ['bl-1'], attachedSnippets: [SNIPPET] },
        backlogMap
      )
    );

    expect(assembled).toEqual({
      attachedBacklogItems: [{ _id: 'bl-1', content: 'Fix login', status: 'backlog' }],
      attachedSnippets: [SNIPPET],
    });
  });
});
