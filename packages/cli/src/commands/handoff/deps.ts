/**
 * Handoff Deps — dependency interfaces for the handoff command.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface HandoffDeps {
  backend: BackendOps;
  session: SessionOps;
}
