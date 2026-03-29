/**
 * Skill commands — list and activate chatroom skills.
 */

import type { SkillDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
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

// ─── Auth Helper ───────────────────────────────────────────────────────────

function requireAuth(d: SkillDeps): string {
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }
  return sessionId as string;
}

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * List all enabled skills for a chatroom.
 */
export async function listSkills(
  chatroomId: string,
  options: ListSkillsOptions,
  deps?: SkillDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);

  try {
    const skills = await d.backend.query(api.skills.list, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    if (!skills || skills.length === 0) {
      console.log('No skills available.');
      return;
    }

    // Calculate column width for aligned output
    const maxSkillIdLen = Math.max(
      ...skills.map(
        (s: { skillId: string; name: string; description: string; type: string }) =>
          s.skillId.length
      )
    );

    console.log('Available skills:');
    for (const skill of skills) {
      const padded = skill.skillId.padEnd(maxSkillIdLen);
      console.log(`  ${padded}  ${skill.description}`);
    }
  } catch (error) {
    console.error(`❌ Failed to list skills: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

/**
 * Activate a named skill in the chatroom, creating a pending task with the skill's prompt.
 */
export async function activateSkill(
  chatroomId: string,
  skillId: string,
  options: ActivateSkillOptions,
  deps?: SkillDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);

  try {
    const convexUrl = d.session.getConvexUrl();

    const result = await d.backend.mutation(api.skills.activate, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      skillId,
      role: options.role,
      convexUrl: convexUrl ?? undefined,
    });

    console.log('');
    console.log(`✅ Skill "${result.skill.skillId}" activated.`);
    console.log(`   The agent will now: ${result.skill.description}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to activate skill: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
