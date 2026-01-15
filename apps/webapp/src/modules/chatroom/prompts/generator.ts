/**
 * Agent Prompt Generator
 *
 * Generates complete, copy-paste ready prompts for initializing AI agents.
 * This module composes prompts from the organized prompt sections.
 */

import {
  getHeaderSection,
  getResponsibilitiesSection,
  getGettingStartedSection,
  getCommunicationSection,
  getHandoffOptionsSection,
  getImportantNotesSection,
  getExampleSection,
  type InitPromptContext,
} from './init/base';
import { getRoleSpecificGuidance } from './init/roles';
import { getTaskStartedSection } from './init/task-started';
import { getWaitForMessageSection } from './init/wait-for-message';
import { getRoleTemplate } from './templates';

export interface PromptContext {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
}

/**
 * Generate a complete agent initialization prompt
 */
export function generateAgentPrompt(context: PromptContext): string {
  const { chatroomId, role, teamName, teamRoles } = context;
  const template = getRoleTemplate(role);

  // Determine available handoff targets (other roles in the team + user)
  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  // Build the init prompt context
  const ctx: InitPromptContext = {
    chatroomId,
    role,
    teamName,
    teamRoles,
    template,
    handoffTargets,
  };

  // Get role-specific guidance
  const roleSpecificGuidance = getRoleSpecificGuidance(role, otherRoles);

  // Compose the prompt from sections
  const sections = [
    getHeaderSection(ctx),
    getResponsibilitiesSection(ctx),
    getGettingStartedSection(ctx),
    getTaskStartedSection(ctx),
    getCommunicationSection(ctx),
    getHandoffOptionsSection(ctx),
    roleSpecificGuidance,
    getImportantNotesSection(),
    getWaitForMessageSection(ctx),
    getExampleSection(ctx),
  ];

  // Filter out empty sections and join with double newlines
  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
}

/**
 * Generate a short prompt for display in limited space
 */
export function generateShortPrompt(context: PromptContext): string {
  const { chatroomId, role } = context;
  return `chatroom wait-for-message ${chatroomId} --role=${role}`;
}
