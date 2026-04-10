import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface FileDeps {
  backend: BackendOps;
  session: SessionOps;
}
