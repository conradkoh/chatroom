/**
 * Integrations Deps — dependency interfaces for the integrations commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface IntegrationsDeps {
  backend: BackendOps;
  session: SessionOps;
}
