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
import { getWaitForTaskSection } from './init/wait-for-task';
import { getRoleTemplate } from './templates';

export interface PromptContext {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
}

/**
 * Generate a complete agent initialization prompt
 */
export function generateAgentPrompt(context: PromptContext): string {
  const { chatroomId, role, teamName, teamRoles, teamEntryPoint } = context;
  const template = getRoleTemplate(role);

  // Determine available handoff targets (other roles in the team + user)
  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  // Determine if this role is the entry point (receives user messages directly)
  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();

  // Build the init prompt context
  const ctx: InitPromptContext = {
    chatroomId,
    role,
    teamName,
    teamRoles,
    template,
    handoffTargets,
    isEntryPoint,
  };

  // Get role-specific guidance
  const roleSpecificGuidance = getRoleSpecificGuidance(role, otherRoles, isEntryPoint);

  // Compose the prompt from sections
  // Only include task-started section for entry-point roles
  const sections = [
    getHeaderSection(ctx),
    getResponsibilitiesSection(ctx),
    getGettingStartedSection(ctx),
    isEntryPoint ? getTaskStartedSection(ctx) : '',
    getCommunicationSection(ctx),
    getHandoffOptionsSection(ctx),
    roleSpecificGuidance,
    getImportantNotesSection(),
    getWaitForTaskSection(ctx),
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
  return `chatroom wait-for-task ${chatroomId} --role=${role}`;
}
