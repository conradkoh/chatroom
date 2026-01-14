/**
 * Prompts module - main exports
 *
 * This module provides prompt generation for agent initialization,
 * handoff instructions, and system reminders.
 */

// Main generator (generates complete init prompts)
export { generateAgentPrompt, generateShortPrompt } from './generator';
export type { PromptContext } from './generator';

// Role templates
export { getRoleTemplate, ROLE_TEMPLATES } from './templates';
export type { RoleTemplate } from './templates';

// Init prompt sections (for customization)
export * from './init';
