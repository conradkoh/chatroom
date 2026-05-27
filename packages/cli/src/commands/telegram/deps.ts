/**
 * Telegram Deps — dependency interfaces for the telegram commands.
 */

import type { SessionOps } from '../../infrastructure/deps/index.js';

export interface TelegramBackendOps {
  /** Call a Convex action */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (endpoint: any, args: any) => Promise<any>;
}

export interface TelegramDeps {
  backend: TelegramBackendOps;
  session: SessionOps;
}
