import { isProductionConvexUrl } from '@workspace/backend/prompts/utils/env.js';

const CONVEX_URL_ENV = 'CHATROOM_CONVEX_URL';

/**
 * Build child-process env for chatroom CLI invocations.
 *
 * Uses the daemon-resolved Convex URL rather than re-reading `process.env`,
 * which prevents a developer's local `CHATROOM_CONVEX_URL` from leaking into
 * production agent/command subprocesses.
 *
 * - Production resolved URL → strips `CHATROOM_CONVEX_URL` from child env
 * - Non-production resolved URL → sets it explicitly to the resolved URL
 */
export function buildChatroomSpawnEnv(
  resolvedConvexUrl: string,
  overrides: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };

  if (isProductionConvexUrl(resolvedConvexUrl)) {
    delete env[CONVEX_URL_ENV];
  } else {
    env[CONVEX_URL_ENV] = resolvedConvexUrl;
  }

  return env;
}

/** Standard child env for remote agent spawns (git tools disabled + Convex URL guard). */
export function buildAgentSpawnEnv(resolvedConvexUrl: string): NodeJS.ProcessEnv {
  return buildChatroomSpawnEnv(resolvedConvexUrl, {
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
  });
}

/**
 * Warn when parent shell env disagrees with the daemon-resolved URL.
 * Returns null when there is no mismatch (or env is unset).
 */
export function formatConvexUrlMismatchWarning(resolvedConvexUrl: string): string | null {
  const raw = process.env[CONVEX_URL_ENV];
  if (!raw || raw === resolvedConvexUrl) return null;
  return (
    `${CONVEX_URL_ENV} in shell (${raw}) differs from daemon resolved URL (${resolvedConvexUrl}). ` +
    `Child processes will use resolved URL. Unset ${CONVEX_URL_ENV} when targeting production.`
  );
}
