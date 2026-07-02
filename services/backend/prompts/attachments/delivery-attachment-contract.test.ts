import { expect, test } from 'vitest';

import { DELIVERY_ATTACHMENT_RENDERERS } from './render-delivery-attachments.js';
import { assemblePrimaryDeliveryAttachments } from '../../src/domain/entities/assemble-primary-delivery-attachments.js';
import {
  MESSAGE_ATTACHMENT_KINDS,
  PRIMARY_DELIVERY_ATTACHMENT_KINDS,
  PRIMARY_DELIVERY_INPUT_KEY_BY_KIND,
} from '../../src/domain/entities/message-attachments.js';

test('every primary-delivery kind has a renderer, input field mapping, and assembler coverage', () => {
  for (const kind of PRIMARY_DELIVERY_ATTACHMENT_KINDS) {
    expect(MESSAGE_ATTACHMENT_KINDS).toContain(kind);
    expect(DELIVERY_ATTACHMENT_RENDERERS[kind]).toBeDefined();
    expect(PRIMARY_DELIVERY_INPUT_KEY_BY_KIND[kind]).toBeDefined();
  }

  const assembled = assemblePrimaryDeliveryAttachments({
    attachedBacklogItems: [{ _id: 'b1', content: 'Backlog', status: 'backlog' }],
    attachedSnippets: [{ reference: 'r1', fileSource: 'a.ts', selectedContent: 'code' }],
    attachedTasks: [{ _id: 't1', content: 'Task', status: 'backlog' }],
    attachedMessages: [{ _id: 'm1', content: 'Message', senderRole: 'user' }],
  });
  for (const kind of PRIMARY_DELIVERY_ATTACHMENT_KINDS) {
    const key = PRIMARY_DELIVERY_INPUT_KEY_BY_KIND[kind];
    expect(assembled?.[key]).toBeDefined();
  }
});

test('PRIMARY_DELIVERY_INPUT_KEY_BY_KIND is exhaustive over PRIMARY_DELIVERY_ATTACHMENT_KINDS', () => {
  expect(Object.keys(PRIMARY_DELIVERY_INPUT_KEY_BY_KIND).sort()).toEqual(
    [...PRIMARY_DELIVERY_ATTACHMENT_KINDS].sort()
  );
});

test('every MESSAGE_ATTACHMENT_KIND has a renderer entry', () => {
  expect(Object.keys(DELIVERY_ATTACHMENT_RENDERERS).sort()).toEqual(
    [...MESSAGE_ATTACHMENT_KINDS].sort()
  );
});
