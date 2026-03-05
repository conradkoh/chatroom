/** Convex queries for serving agent prompts to the CLI. */

import { v } from 'convex/values';

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
  handler: async (_ctx, args) => {
    return generateAgentPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
      convexUrl: args.convexUrl,
    });
  },
});
