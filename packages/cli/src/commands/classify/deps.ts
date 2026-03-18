/**
 * Classify Deps — dependency interfaces for the classify command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/**
 * All external dependencies for the classify command.
 *
 * - `backend`: Convex client for queries and mutations
 * - `session`: Authentication and session retrieval
 */
export interface ClassifyDeps {
  backend: BackendOps;
  session: SessionOps;
}