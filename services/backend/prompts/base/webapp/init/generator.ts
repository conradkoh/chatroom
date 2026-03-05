/**
 * Agent Prompt Generator (Webapp / Custom Agent Version)
 *
 * Generates the full agent system prompt for custom agents (those set up by
 * copy-pasting the init prompt from the webapp). Delegates to composeSystemPrompt()
 * with agentType: 'custom' to ensure custom agents receive the same complete
 * prompt as remote agents.
 *
 * Used by:
 *   - Convex query api.prompts.webapp.getAgentPrompt (CLI get-system-prompt command)
 *   - PromptsContext (webapp frontend — pre-generates prompts for copy-paste UI)
 */

import { composeSystemPrompt } from '../../../generator';
import { getCliEnvPrefix } from '../utils/env';

export interface PromptContext {
  chatroomId: string;
  role: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  /** The Convex URL being used. If non-production, CLI commands will include env var override. */
  convexUrl?: string;
}

/**
 * Generate a full agent initialization prompt for UI display.
 * Delegates to composeSystemPrompt() to ensure custom agents receive
 * the same complete prompt as remote agents (classification guide,
 * role workflow, commands reference, etc.).
 */
export function generateAgentPrompt(context: PromptContext): string {
  const { chatroomId, role, teamId, teamName, teamRoles, teamEntryPoint, convexUrl } = context;
  return composeSystemPrompt({
    chatroomId,
    role,
    teamId,
    teamName,
    teamRoles,
    teamEntryPoint,
    convexUrl: convexUrl ?? '',
    agentType: 'custom',
  });
}

/**
 * Generate a short prompt for display in limited space
 */
export function generateShortPrompt(context: PromptContext): string {
  const { chatroomId, role, convexUrl } = context;
  const prefix = getCliEnvPrefix(convexUrl);
  return `${prefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}" && ${prefix}chatroom get-next-task --chatroom-id="${chatroomId}" --role="${role}"`;
}
