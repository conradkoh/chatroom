/**
 * Auth-Login Deps — dependency interfaces for the auth-login command.
 */

import type { BackendOps } from '../../infrastructure/deps/index.js';

export interface AuthLoginDeps {
  backend: BackendOps;
}
