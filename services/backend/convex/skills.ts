import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';
import { activateSkill } from '../src/domain/usecase/skills/activate-skill';
import { getSkill } from '../src/domain/usecase/skills/get-skill';
import { listSkills } from '../src/domain/usecase/skills/list-skills';
import { SKILLS_REGISTRY } from '../src/domain/usecase/skills/registry';

const config = getConfig();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all built-in skills.
 * Delegates to the list-skills use case — no DB access.
 */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return listSkills();
  },
});

/**
 * Get the default content (prompt body without the activation header) for a skill.
 * Used by SkillsTab to seed the editor and show the default-prompt preview,
 * so the registry is the single source of truth — no hardcoded strings in the UI.
 */
export const getDefaultSkillContent = query({
  args: { skillId: v.string() },
  handler: async (_ctx, args) => {
    const skill = SKILLS_REGISTRY.find((s) => s.skillId === args.skillId);
    if (!skill) return null;
    const fullPrompt = skill.getPrompt('');
    // Strip the leading activation header so the editor shows only the customizable body.
    const lines = fullPrompt.split('\n');
    const firstSubstantiveLine = lines.findIndex((l) => l.startsWith('## '));
    return firstSubstantiveLine === -1 ? fullPrompt : lines.slice(firstSubstantiveLine).join('\n');
  },
});

/**
 * Fetch a single skill by skillId.
 * Delegates to the get-skill use case — no DB access.
 */
export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));
    return getSkill(args.skillId, cliEnvPrefix);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Activate a skill for a chatroom.
 * Delegates to the activate-skill use case.
 */
export const activate = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));
    return activateSkill(ctx, chatroom, {
      chatroomId: args.chatroomId,
      skillId: args.skillId,
      role: args.role,
      cliEnvPrefix,
    });
  },
});
