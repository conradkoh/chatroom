/** Convex queries for serving agent prompts to the CLI. */

import { v } from 'convex/values';

import { generateAgentPrompt } from '../../prompts/base/webapp/init/generator';
import { query } from '../_generated/server';

/** Returns the full agent initialization prompt for a role (used by the CLI get-system-prompt command). */
export const getAgentPrompt = query({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    teamId: v.optional(v.string()),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for a prompt override for this chatroom
    const override = await ctx.db
      .query('chatroom_prompts')
      .withIndex('by_chatroomId_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('type', 'development_workflow')
      )
      .first();

    const basePrompt = generateAgentPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
      convexUrl: args.convexUrl,
    });

    if (override && override.isEnabled) {
      return override.content;
    }

    return basePrompt;
  },
});
