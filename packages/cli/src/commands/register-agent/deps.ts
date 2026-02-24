/**
 * Register-Agent Deps — dependency interfaces for the register-agent command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface RegisterAgentDeps {
  backend: BackendOps;
  session: SessionOps;
}
