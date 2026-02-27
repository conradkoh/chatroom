/**
 * Webapp Prompt Queries
 *
 * Provides agent prompts to the CLI through Convex queries.
 * Note: The webapp frontend generates prompts directly using the shared
 * generateAgentPrompt function — no API calls needed for webapp display.
 */

import { v } from 'convex/values';

import {
  generateAgentPrompt,
} from '../../prompts/base/webapp/init/generator.js';
import { query } from '../_generated/server';

/**
 * Get the full agent initialization prompt for a specific role.
 * Used by the CLI (get-system-prompt command) to fetch the display prompt.
 *
 * Note: The webapp frontend calls generateAgentPrompt directly — this query
 * exists only for CLI consumers that cannot import from the shared package.
 */
export const getAgentPrompt = query({
  args: {
    chatroomId: v.string(),
    role: v.string(),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
    convexUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return generateAgentPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
      convexUrl: args.convexUrl,
    });
  },
});
