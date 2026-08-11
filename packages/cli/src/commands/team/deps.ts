import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export interface TeamDeps {
  backend: Pick<BackendOps, 'mutation' | 'query'>;
  session: Pick<SessionOps, 'getSessionId'>;
}
