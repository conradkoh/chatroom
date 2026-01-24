/**
 * Agent Prompt Utilities
 *
 * Re-exports prompt generation functions from the backend for webapp use.
 * This file serves as the architectural boundary - the webapp imports from here,
 * not directly from the backend package.
 *
 * In the future, these could be replaced with Convex queries if real-time
 * updates or server-side generation becomes necessary.
 */

export { generateAgentPrompt, generateShortPrompt } from '@workspace/backend/prompts/base/webapp';
export type { PromptContext } from '@workspace/backend/prompts/base/webapp';
export { isProductionConvexUrl, getCliEnvPrefix } from '@workspace/backend/prompts/base/webapp';
export { getRoleTemplate, ROLE_TEMPLATES } from '@workspace/backend/prompts/base/webapp';
export type { RoleTemplate } from '@workspace/backend/prompts/base/webapp';
