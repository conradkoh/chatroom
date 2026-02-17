/**
 * File System Operations — shared dependency interface for filesystem access.
 *
 * Wraps fs.stat and similar operations to decouple command handlers
 * from direct filesystem access. Used for path validation and similar checks.
 */

import type { Stats } from 'node:fs';

export interface FsOps {
  /** Get file/directory stats (wraps fs.stat) */
  stat: (path: string) => Promise<Stats>;
}
