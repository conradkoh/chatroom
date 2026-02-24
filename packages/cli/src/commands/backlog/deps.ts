/**
 * Backlog Deps — dependency interfaces for the backlog commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface BacklogDeps {
  backend: BackendOps;
  session: SessionOps;
}
