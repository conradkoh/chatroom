/**
 * Guidelines CLI Commands
 *
 * Commands for viewing review guidelines by type.
 * Phase 2: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { GuidelinesDeps } from './deps.js';
import { api } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { GuidelinesDeps } from './deps.js';
export interface ViewGuidelinesOptions {
  type: string;
}

const VALID_TYPES = ['coding', 'security', 'design', 'performance', 'all'];

// ─── Domain errors ─────────────────────────────────────────────────────────

export type GuidelinesError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'InvalidType'; readonly type: string }
  | { readonly _tag: 'BackendError'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<GuidelinesDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

/**
 * Build Effect Layer from GuidelinesDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: GuidelinesDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(BackendServiceLive(deps.backend), SessionServiceLive(deps.session));
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const viewGuidelinesEffect = (
  options: ViewGuidelinesOptions
): Effect.Effect<void, GuidelinesError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const { type } = options;

    // Validate type
    if (!VALID_TYPES.includes(type)) {
      return yield* Effect.fail<GuidelinesError>({ _tag: 'InvalidType', type });
    }

    // Get session ID for authentication
    const session = yield* SessionService;
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      return yield* Effect.fail<GuidelinesError>({ _tag: 'NotAuthenticated' });
    }

    // Query backend
    const backend = yield* BackendService;
    const result = yield* backend
      .query<{ title: string; content: string }>(api.guidelines.getGuidelines, {
        type: type as 'coding' | 'security' | 'design' | 'performance' | 'all',
      })
      .pipe(Effect.mapError((cause): GuidelinesError => ({ _tag: 'BackendError', cause })));

    // Print output (side effect in the Effect monad)
    yield* Effect.sync(() => {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`📋 ${result.title}`);
      console.log(`${'═'.repeat(60)}\n`);
      console.log(result.content);
      console.log(`\n${'═'.repeat(60)}\n`);
    });
  });

/**
 * Pure Effect program for listing guideline types.
 */
// fallow-ignore-next-line unused-export
export const listGuidelineTypesEffect = (): Effect.Effect<
  void,
  GuidelinesError,
  BackendService | SessionService
> =>
  Effect.gen(function* () {
    // Get session ID for authentication
    const session = yield* SessionService;
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      return yield* Effect.fail<GuidelinesError>({ _tag: 'NotAuthenticated' });
    }

    // Query backend
    const backend = yield* BackendService;
    const types = yield* backend
      .query<{ type: string; description: string }[]>(api.guidelines.listGuidelineTypes, {})
      .pipe(Effect.mapError((cause): GuidelinesError => ({ _tag: 'BackendError', cause })));

    // Print output (side effect in the Effect monad)
    yield* Effect.sync(() => {
      console.log(`\n📋 Available Guideline Types\n`);
      console.log(`${'─'.repeat(50)}`);

      for (const t of types) {
        console.log(`  ${t.type.padEnd(12)} - ${t.description}`);
      }

      console.log(`${'─'.repeat(50)}`);
      console.log(`\nUsage: chatroom guidelines view --type=<type>\n`);
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects for viewGuidelines.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleViewGuidelinesError(err: GuidelinesError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error('❌ Not authenticated. Please run: chatroom auth login');
    } else if (err._tag === 'InvalidType') {
      console.error(`❌ Invalid guideline type: "${err.type}"`);
      console.error(`   Valid types: ${VALID_TYPES.join(', ')}`);
    } else {
      console.error(`❌ Error fetching guidelines: ${err.cause.message}`);
    }
    process.exit(1);
  });
}

/**
 * Maps typed errors to console.error + process.exit(1) effects for listGuidelineTypes.
 */
function handleListGuidelineTypesError(err: GuidelinesError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error('❌ Not authenticated. Please run: chatroom auth login');
    } else if (err._tag === 'BackendError') {
      console.error(`❌ Error fetching guideline types: ${err.cause.message}`);
    }
    process.exit(1);
  });
}

// ─── Entry Points (public API — unchanged signature) ──────────────────────

/**
 * View guidelines by type
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function viewGuidelines(
  options: ViewGuidelinesOptions,
  deps?: GuidelinesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    viewGuidelinesEffect(options).pipe(
      Effect.catchAll((err) => handleViewGuidelinesError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * List available guideline types
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function listGuidelineTypes(deps?: GuidelinesDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    listGuidelineTypesEffect().pipe(
      Effect.catchAll((err) => handleListGuidelineTypesError(err)),
      Effect.provide(layer)
    )
  );
}
