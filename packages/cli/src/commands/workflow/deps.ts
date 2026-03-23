/**
 * Workflow Deps — dependency interfaces for the workflow commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface WorkflowDeps {
  backend: BackendOps;
  session: SessionOps;
}
