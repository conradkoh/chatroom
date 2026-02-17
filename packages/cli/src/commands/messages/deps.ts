import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface MessagesDeps {
  backend: BackendOps;
  session: SessionOps;
}
