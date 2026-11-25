import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { ATTACHMENTS_GUIDE_CONTENT } from './attachments-guide-content.js';
import { renderDeliveryAttachmentsBlock } from './render-delivery-attachments.js';

const guideDir = dirname(fileURLToPath(import.meta.url));

describe('attachments-guide-content', () => {
  test('stays in sync with ATTACHMENTS_GUIDE.md', () => {
    const markdown = readFileSync(join(guideDir, 'ATTACHMENTS_GUIDE.md'), 'utf-8');
    expect(ATTACHMENTS_GUIDE_CONTENT).toBe(markdown);
  });

  test('guide contains every backlog interaction line the renderer emits', () => {
    const lines = renderDeliveryAttachmentsBlock(
      {
        attachedBacklogItems: [{ _id: 'item-111', content: 'Add login page', status: 'backlog' }],
      },
      { chatroomId: '...', role: '...' }
    );
    const interactionLines = lines.filter((line) => line.includes('<interaction '));
    expect(interactionLines).toHaveLength(2);
    for (const line of interactionLines) {
      expect(ATTACHMENTS_GUIDE_CONTENT).toContain(line.trim());
    }
  });

  test('documents key attachment architecture', () => {
    expect(ATTACHMENTS_GUIDE_CONTENT).toContain('renderDeliveryAttachmentsBlock');
    expect(ATTACHMENTS_GUIDE_CONTENT).toContain('AttachmentChipShell');
    expect(ATTACHMENTS_GUIDE_CONTENT).not.toContain('AttachedTaskDetailModal');
    expect(ATTACHMENTS_GUIDE_CONTENT).not.toContain('chatroom skill activate attachments');
    expect(ATTACHMENTS_GUIDE_CONTENT).not.toContain('--attach-artifact');
  });
});
