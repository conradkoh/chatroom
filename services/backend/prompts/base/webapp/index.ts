/**
 * Webapp Prompts
 *
 * These prompts are used by the webapp for UI display purposes only.
 * They provide a simplified view of agent initialization for the dashboard.
 *
 * The CLI uses the full prompts from base/cli/ which are served by the backend.
 */

export { generateAgentPrompt, generateShortPrompt } from './init/generator.js';
export type { PromptContext } from './init/generator.js';

export { getRoleTemplate, ROLE_TEMPLATES } from './init/templates.js';
export type { RoleTemplate } from './init/templates.js';

export { isProductionConvexUrl, getCliEnvPrefix } from './utils/env.js';

export { HANDOFF_DIR, getHandoffFileSnippet, getMultiFileSnippet } from './utils/config.js';
