/**
 * Daemon-facing harness model catalog endpoints.
 *
 * Serve the server-curated model catalog (`HARNESS_MODEL_CATALOG`) to daemons,
 * which fetch it at boot and on manual refresh and overlay it onto local
 * discovery. Per-harness modules (`codexSdk.ts`, `copilot.ts`, `cursor.ts`)
 * each expose `api.harnesses.<harness>.listModels`.
 */

import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  HARNESS_MODEL_CATALOG,
  type CatalogBackedHarness,
} from '../../src/domain/entities/harness/model-catalog';
import { query } from '../_generated/server';
import { requireSession } from '../auth/session';

/**
 * Query factory for `api.harnesses.<harness>.listModels`.
 *
 * The catalog is global (not machine-scoped), so only a valid session is
 * required — the daemon passes its boot-time session id.
 */
export function createHarnessListModelsQuery(harness: CatalogBackedHarness) {
  return query({
    args: { ...SessionIdArg },
    handler: async (ctx, args) => {
      await requireSession(ctx, args.sessionId);
      return [...(HARNESS_MODEL_CATALOG[harness] ?? [])];
    },
  });
}
