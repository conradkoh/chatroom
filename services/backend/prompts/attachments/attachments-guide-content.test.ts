import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { ATTACHMENTS_GUIDE_CONTENT } from './attachments-guide-content.js';

const guideDir = dirname(fileURLToPath(import.meta.url));

describe('attachments-guide-content', () => {
  test('stays in sync with ATTACHMENTS_GUIDE.md', () => {
    const markdown = readFileSync(join(guideDir, 'ATTACHMENTS_GUIDE.md'), 'utf-8');
    expect(ATTACHMENTS_GUIDE_CONTENT).toBe(markdown);
  });

  test('documents key attachment architecture', () => {
    expect(ATTACHMENTS_GUIDE_CONTENT).toContain('renderDeliveryAttachmentsBlock');
    expect(ATTACHMENTS_GUIDE_CONTENT).toContain('AttachmentChipShell');
    expect(ATTACHMENTS_GUIDE_CONTENT).not.toContain('AttachedTaskDetailModal');
  });
});
