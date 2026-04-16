import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';
import { activateSkill } from '../src/domain/usecase/skills/activate-skill';
import { getSkill } from '../src/domain/usecase/skills/get-skill';
import { listSkills } from '../src/domain/usecase/skills/list-skills';

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
    const skill = getSkill(args.skillId, cliEnvPrefix);
    if (!skill) return null;

    // Override resolution: check for chatroom custom prompt
    if (args.skillId === 'development-workflow') {
      const override = await ctx.db
        .query('chatroom_prompts')
        .withIndex('by_chatroomId_type', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('type', 'development_workflow')
        )
        .first();

      if (override && override.isEnabled) {
        return { ...skill, prompt: override.content };
      }
    }

    return skill;
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
