import { createHash } from 'node:crypto';

import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

/** md5 of JSON.stringify(tree) — must match upload hash in file-tree-subscription. */
export function computeFileTreeDataHash(tree: FileTree): string {
  return createHash('md5').update(JSON.stringify(tree)).digest('hex');
}
