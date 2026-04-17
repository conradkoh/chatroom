/** Convex queries for serving agent prompts to the CLI. */

import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';

import { generateAgentPrompt } from '../../prompts/base/webapp/init/generator';
import { query } from '../_generated/server';

/** Returns the full agent initialization prompt for a role (used by the CLI get-system-prompt command). */
export const getAgentPrompt = query({
  args: {
    chatroomId: v.string(),
    role: v.string(),
    teamId: v.optional(v.string()),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve chatroom ID from slug/string
    // CLI passes chatroom ID as string - try to parse it as an Id
    let chatroomId: Id<'chatroom_rooms'> | undefined;
    try {
      chatroomId = args.chatroomId as Id<'chatroom_rooms'>;
      // Verify it exists
      const chatroom = await ctx.db.get(chatroomId);
      if (!chatroom) {
        chatroomId = undefined;
      }
    } catch {
      // Not a valid Id format, will skip customization lookup
      chatroomId = undefined;
    }

    // Check for a skill customization for this chatroom
    const customization = chatroomId
      ? await ctx.db
          .query('chatroom_skillCustomizations')
          .withIndex('by_chatroomId_type', (q) =>
            q.eq('chatroomId', chatroomId!).eq('type', 'development_workflow')
          )
          .first()
      : null;

    const basePrompt = generateAgentPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
      convexUrl: args.convexUrl,
    });

    if (customization && customization.isEnabled) {
      return customization.content;
    }

    return basePrompt;
  },
});
