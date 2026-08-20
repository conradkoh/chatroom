import { describe, expect, it } from 'vitest';

import { WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE } from './workspace-file-tree-delta-outbox.js';

describe('workspace delta outbox', () => {
  it('owns the batch size', () => expect(WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE).toBe(5));
});
