/**
 * Webapp Prompt Queries
 *
 * Provides agent prompts and related data to the webapp through Convex queries.
 * This replaces direct imports from the backend package, maintaining proper
 * architectural boundaries between frontend and backend.
 */

import { v } from 'convex/values';

import {
  generateAgentPrompt,
  generateShortPrompt,
} from '../../prompts/base/webapp/init/generator.js';
import { getRoleTemplate, ROLE_TEMPLATES } from '../../prompts/base/webapp/init/templates.js';
import { isProductionConvexUrl } from '../../prompts/base/webapp/utils/env.js';
import { query } from '../_generated/server';

/**
 * Get the full agent initialization prompt for a specific role.
 * Returns the markdown prompt that includes role description, responsibilities,
 * and CLI command to join the chatroom.
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

/**
 * Get a short CLI command string for a specific role.
 * Used in limited space contexts like tooltips or compact displays.
 */
export const getShortPrompt = query({
  args: {
    chatroomId: v.string(),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return generateShortPrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: '', // Not needed for short prompt
      teamRoles: [], // Not needed for short prompt
      convexUrl: args.convexUrl,
    });
  },
});

/**
 * Get the role template for a specific role.
 * Returns the title, description, and responsibilities for display.
 */
export const getRoleInfo = query({
  args: {
    role: v.string(),
  },
  handler: async (_ctx, args) => {
    return getRoleTemplate(args.role);
  },
});

/**
 * Get all available role templates.
 * Useful for displaying role options or documentation.
 */
export const getAllRoleTemplates = query({
  args: {},
  handler: async () => {
    return ROLE_TEMPLATES;
  },
});

/**
 * Get all agent prompts for an entire team in a single query.
 * Returns a record mapping each role to its full prompt string.
 * This avoids the need for multiple individual useQuery calls on the frontend,
 * which would violate React's Rules of Hooks when the team changes.
 */
export const getTeamPrompts = query({
  args: {
    chatroomId: v.string(),
    teamName: v.string(),
    teamRoles: v.array(v.string()),
    teamEntryPoint: v.optional(v.string()),
    convexUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const prompts: Record<string, string> = {};
    for (const role of args.teamRoles) {
      prompts[role] = generateAgentPrompt({
        chatroomId: args.chatroomId,
        role,
        teamName: args.teamName,
        teamRoles: args.teamRoles,
        teamEntryPoint: args.teamEntryPoint,
        convexUrl: args.convexUrl,
      });
    }
    return prompts;
  },
});

/**
 * Check if a Convex URL is the production URL.
 * Helps the webapp determine if env var overrides are needed in CLI commands.
 */
export const checkIsProductionUrl = query({
  args: {
    convexUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return isProductionConvexUrl(args.convexUrl);
  },
});
