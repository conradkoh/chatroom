/**
 * Compact Deps — dependency interfaces for the compact command.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface CompactDeps {
  backend: BackendOps;
  session: SessionOps;
}
