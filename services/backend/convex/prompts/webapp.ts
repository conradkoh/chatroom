/** Convex queries for serving agent prompts to the CLI. */

import { v } from 'convex/values';

import { generateAgentPrompt } from '../../prompts/base/webapp/init/generator';
import { composeRoleGuidance } from '../../prompts/role-guidance';
import { DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE } from '../../src/domain/types/skills';
import { getAgentConfig } from '../../src/domain/usecase/agent/get-agent-config';
import type { Id } from '../_generated/dataModel';
import { query } from '../_generated/server';

const rolePromptQueryArgs = {
  chatroomId: v.string(),
  role: v.string(),
  teamId: v.optional(v.string()),
  teamName: v.string(),
  teamRoles: v.array(v.string()),
  teamEntryPoint: v.optional(v.string()),
  convexUrl: v.optional(v.string()),
};

/** Returns the full agent initialization prompt for a role (used by the CLI get-system-prompt command). */
export const getAgentPrompt = query({
  args: rolePromptQueryArgs,
  handler: async (ctx, args) => {
    // Resolve chatroom for customization lookup. If the ID is malformed or
    // doesn't exist, fall back to the default prompt and log so it's debuggable.
    const chatroomId = args.chatroomId as Id<'chatroom_rooms'>;
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    if (!chatroom) {
      console.warn(
        `[getAgentPrompt] Chatroom not found for ID "${args.chatroomId}" — using default prompt.`
      );
    }

    // Check for a skill customization for this chatroom
    const customization = chatroom
      ? await ctx.db
          .query('chatroom_skillCustomizations')
          .withIndex('by_chatroomId_type', (q) =>
            q.eq('chatroomId', chatroomId).eq('type', DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE)
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

/** Returns role-specific operating-model guidance (used by get-role-guidance CLI). */
export const getRoleGuidance = query({
  args: rolePromptQueryArgs,
  handler: async (ctx, args) => {
    const chatroomId = args.chatroomId as Id<'chatroom_rooms'>;
    const agentConfigResult = await getAgentConfig(ctx, {
      chatroomId,
      role: args.role,
    });

    return composeRoleGuidance({
      chatroomId: args.chatroomId,
      role: args.role,
      teamId: args.teamId,
      teamName: args.teamName,
      teamRoles: args.teamRoles,
      teamEntryPoint: args.teamEntryPoint,
      convexUrl: args.convexUrl ?? '',
      agentType: agentConfigResult.found
        ? (agentConfigResult.config.type as 'remote' | 'custom' | 'unset')
        : 'unset',
      agentHarness: agentConfigResult.found ? agentConfigResult.config.agentHarness : undefined,
    });
  },
});
