/**
 * Skill commands — list and activate chatroom skills.
 * Phase 7: Migrated to Effect-TS services with typed error handling.
 */

import { Effect } from 'effect';

import type { SkillDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import {
  externalSkillsOpsLive,
  mergeSkillCatalog,
  type ExternalSkillsOps,
  type SkillCatalog,
} from '../../infrastructure/external-skills/index.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  SessionService,
  requireSessionForChatroomEffect,
} from '../../infrastructure/services/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';
import { sanitizeForTerminal } from '../../utils/terminal-safety.js';

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
  return { ...(await createConvexCommandDeps()), externalSkills: externalSkillsOpsLive };
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for listing skills
 */
// fallow-ignore-next-line unused-export
export const listSkillsEffect = (
  chatroomId: string,
  _options: ListSkillsOptions,
  externalSkills: ExternalSkillsOps
): Effect.Effect<void, ListSkillsError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });

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

    // Discover machine-installed skills (never rejects) and merge with builtins
    const discovery = yield* Effect.promise(() => externalSkills.discover());
    const catalog = mergeSkillCatalog(skills ?? [], discovery);

    // Display skills
    yield* Effect.sync(() => printSkillCatalog(catalog));
  });

/** Print the merged catalog. Builtin lines are unchanged; external fields are sanitized. */
function printSkillCatalog(catalog: SkillCatalog): void {
  if (catalog.builtin.length === 0 && catalog.external.length === 0) {
    console.log('No skills available.');
  }
  printBuiltinSkills(catalog.builtin);
  printExternalSkills(catalog.external, catalog.builtin.length > 0);
  printSkippedSkills(catalog.issues);
}

function printBuiltinSkills(skills: SkillCatalog['builtin']): void {
  if (skills.length === 0) return;
  // Calculate column width for aligned output
  const maxSkillIdLen = Math.max(...skills.map((s) => s.skillId.length));

  console.log('Available skills:');
  for (const skill of skills) {
    console.log(`  ${skill.skillId.padEnd(maxSkillIdLen)}  ${skill.description}`);
  }
}

function printExternalSkills(skills: SkillCatalog['external'], afterBuiltins: boolean): void {
  if (skills.length === 0) return;
  if (afterBuiltins) console.log('');

  const maxIdLen = Math.max(...skills.map((s) => s.skillId.length));
  // Directory line aligns under the description column.
  const directoryIndent = ' '.repeat(2 + maxIdLen + 2);

  console.log('Installed skills (this machine):');
  for (const skill of skills) {
    console.log(`  ${skill.skillId.padEnd(maxIdLen)}  ${sanitizeForTerminal(skill.description)}`);
    console.log(`${directoryIndent}${sanitizeForTerminal(skill.skillDir)}`);
  }
}

function printSkippedSkills(issues: SkillCatalog['issues']): void {
  if (issues.length === 0) return;

  console.log('Skipped installed skills:');
  for (const issue of issues) {
    const detail = issue.detail === undefined ? '' : ` (${sanitizeForTerminal(issue.detail)})`;
    console.log(`  ${sanitizeForTerminal(issue.path)}: ${issue.reason}${detail}`);
  }
}

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
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });

    const convexUrl = yield* session.getConvexUrl();

    // Activate skill
    const result = yield* backend
      .mutation<{
        skill: { skillId: string; prompt?: string | undefined };
      }>(api.skills.activate, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        skillId,
        role: options.role,
        convexUrl: convexUrl ?? undefined,
      })
      .pipe(Effect.mapError((cause): ActivateSkillError => ({ _tag: 'MutationFailed', cause })));

    // Display success
    // CRAP-only: pre-commit audit runs without --coverage (CRAP=cc²+cc); covered by commands/skill/index.test.ts. Remove when the gate receives coverage.
    // fallow-ignore-next-line complexity
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
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
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
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
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
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    listSkillsEffect(chatroomId, options, d.externalSkills).pipe(
      Effect.catch((err) => handleListSkillsError(err)),
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
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    activateSkillEffect(chatroomId, skillId, options).pipe(
      Effect.catch((err) => handleActivateSkillError(err)),
      Effect.provide(layer)
    )
  );
}
