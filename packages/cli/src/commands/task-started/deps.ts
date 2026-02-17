/**
 * Task-Started Deps — dependency interfaces for the task-started command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/**
 * All external dependencies for the task-started command.
 *
 * - `backend`: Convex client for queries and mutations
 * - `session`: Authentication and session retrieval
 */
export interface TaskStartedDeps {
  backend: BackendOps;
  session: SessionOps;
}
