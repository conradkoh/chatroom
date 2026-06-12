/**
 * Skill commands — list and activate chatroom skills.
 * Phase 7: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { SkillDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';

// ─── Re-exports ────────────────────────────────────────────────────────────

export type { SkillDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ListSkillsOptions {
  role: string;
}

export interface ActivateSkillOptions {
  role: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type ListSkillsError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

export type ActivateSkillError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'MutationFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<SkillDeps> {
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
 * Build Effect Layer from SkillDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: SkillDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(
    BackendServiceLive({
      query: deps.backend.query,
      mutation: deps.backend.mutation,
    }),
    SessionServiceLive({
      getSessionId: deps.session.getSessionId,
      getConvexUrl: deps.session.getConvexUrl,
      getOtherSessionUrls: deps.session.getOtherSessionUrls,
    })
  );
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for listing skills
 */
// fallow-ignore-next-line unused-export
export const listSkillsEffect = (
  chatroomId: string,
  _options: ListSkillsOptions
): Effect.Effect<void, ListSkillsError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<ListSkillsError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ListSkillsError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Query skills
    const skills = yield* backend
      .query<{ skillId: string; name: string; description: string; type: string }[]>(
        api.skills.list,
        {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        }
      )
      .pipe(Effect.mapError((cause): ListSkillsError => ({ _tag: 'QueryFailed', cause })));

    // Display skills
    yield* Effect.sync(() => {
      if (!skills || skills.length === 0) {
        console.log('No skills available.');
        return;
      }

      // Calculate column width for aligned output
      const maxSkillIdLen = Math.max(...skills.map((s) => s.skillId.length));

      console.log('Available skills:');
      for (const skill of skills) {
        const padded = skill.skillId.padEnd(maxSkillIdLen);
        console.log(`  ${padded}  ${skill.description}`);
      }
    });
  });

/**
 * Pure Effect program for activating a skill
 */
// fallow-ignore-next-line unused-export
export const activateSkillEffect = (
  chatroomId: string,
  skillId: string,
  options: ActivateSkillOptions
): Effect.Effect<void, ActivateSkillError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<ActivateSkillError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ActivateSkillError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Activate skill
    const result = yield* backend
      .mutation<{
        skill: { skillId: string; prompt?: string };
      }>(api.skills.activate, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        skillId,
        role: options.role,
        convexUrl: convexUrl ?? undefined,
      })
      .pipe(Effect.mapError((cause): ActivateSkillError => ({ _tag: 'MutationFailed', cause })));

    // Display success
    yield* Effect.sync(() => {
      console.log('');
      console.log(`✅ Skill "${result.skill.skillId}" activated.`);
      console.log(`   The agent will now:`);
      // Show the full prompt that the agent sees (first 500 chars for display)
      const promptPreview = result.skill.prompt?.slice(0, 500) ?? '(empty)';
      const promptLength = result.skill.prompt?.length ?? 0;
      console.log(`   ${promptPreview}${promptLength > 500 ? '...' : ''}`);
      console.log('');
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 */
function handleListSkillsError(err: ListSkillsError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom skill list ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'QueryFailed') {
      console.error(`❌ Failed to list skills: ${getErrorMessage(err.cause)}`);
      process.exit(1);
    }
  });
}

function handleActivateSkillError(err: ActivateSkillError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom skill activate ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'MutationFailed') {
      console.error(`❌ Failed to activate skill: ${getErrorMessage(err.cause)}`);
      process.exit(1);
    }
  });
}

// ─── Entry Points (public API — unchanged signature) ───────────────────────

/**
 * List all enabled skills for a chatroom.
 */
export async function listSkills(
  chatroomId: string,
  options: ListSkillsOptions,
  deps?: SkillDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    listSkillsEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleListSkillsError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Activate a named skill in the chatroom.
 */
export async function activateSkill(
  chatroomId: string,
  skillId: string,
  options: ActivateSkillOptions,
  deps?: SkillDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    activateSkillEffect(chatroomId, skillId, options).pipe(
      Effect.catchAll((err) => handleActivateSkillError(err)),
      Effect.provide(layer)
    )
  );
}
