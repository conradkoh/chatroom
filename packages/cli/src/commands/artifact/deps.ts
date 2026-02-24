import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface ArtifactDeps {
  backend: BackendOps;
  session: SessionOps;
}
