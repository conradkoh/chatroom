/**
 * Guidelines Deps — dependency interfaces for the guidelines commands.
 *
 * Uses BackendOps and SessionOps for fetching and displaying guidelines.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/**
 * All external dependencies for the guidelines commands.
 */
export interface GuidelinesDeps {
  backend: BackendOps;
  session: SessionOps;
}
