/**
 * Task-Complete Deps — dependency interfaces for the task-complete command.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface TaskCompleteDeps {
  backend: BackendOps;
  session: SessionOps;
}
