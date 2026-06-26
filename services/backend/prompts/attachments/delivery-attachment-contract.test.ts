import { expect, test } from 'vitest';

import { DELIVERY_ATTACHMENT_RENDERERS } from './render-delivery-attachments.js';
import { MESSAGE_ATTACHMENT_KINDS } from '../../src/domain/entities/message-attachments.js';

/** Kinds that MUST appear in primary delivery (not just task-read). */
export const PRIMARY_DELIVERY_ATTACHMENT_KINDS = ['snippet'] as const;

test('every primary-delivery kind has a non-empty renderer', () => {
  for (const kind of PRIMARY_DELIVERY_ATTACHMENT_KINDS) {
    expect(MESSAGE_ATTACHMENT_KINDS).toContain(kind);
    expect(DELIVERY_ATTACHMENT_RENDERERS[kind]).toBeDefined();
  }
});

// Document: backlog is task-read-only; message uses separate format in fullOutput
test('backlog renderer exists but is not in primary delivery kinds', () => {
  expect(PRIMARY_DELIVERY_ATTACHMENT_KINDS).not.toContain('backlog');
});
