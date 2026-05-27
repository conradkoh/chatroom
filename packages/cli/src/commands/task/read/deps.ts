/**
 * Task Read Deps — dependency interfaces for the task read command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

import type { BackendOps, SessionOps } from '../../../infrastructure/deps/index.js';

/**
 * All external dependencies for the task read command.
 *
 * - `backend`: Convex client for mutations
 * - `session`: Authentication and session retrieval
 */
export interface TaskReadDeps {
  backend: BackendOps;
  session: SessionOps;
}
