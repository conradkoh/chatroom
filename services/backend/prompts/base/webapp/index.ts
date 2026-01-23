/**
 * Webapp Prompts
 *
 * These prompts are used by the webapp for UI display purposes only.
 * They provide a simplified view of agent initialization for the dashboard.
 *
 * The CLI uses the full prompts from base/cli/ which are served by the backend.
 */

export {
  generateAgentPrompt,
  generateShortPrompt,
  isProductionConvexUrl,
  getCliEnvPrefix,
} from './generator';
export type { PromptContext } from './generator';

export { getRoleTemplate, ROLE_TEMPLATES } from './templates';
export type { RoleTemplate } from './templates';

export { HANDOFF_DIR, getHandoffFileSnippet, getMultiFileSnippet } from './config';
