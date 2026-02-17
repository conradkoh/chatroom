/**
 * Report-Progress Deps — dependency interfaces for the report-progress command.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface ReportProgressDeps {
  backend: BackendOps;
  session: SessionOps;
}
