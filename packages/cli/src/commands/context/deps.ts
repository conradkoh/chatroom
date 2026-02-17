import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface ContextDeps {
  backend: BackendOps;
  session: SessionOps;
}
