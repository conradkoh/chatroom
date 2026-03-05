/**
 * Webapp Prompts
 *
 * Prompts used by the webapp frontend (PromptsContext) and the CLI's
 * get-system-prompt command. Generates the full agent system prompt via
 * composeSystemPrompt() with agentType: 'custom' for custom agents.
 */

export { generateAgentPrompt, generateShortPrompt } from './init/generator';
export type { PromptContext } from './init/generator';

export { isProductionConvexUrl, getCliEnvPrefix } from './utils/env';

export { HANDOFF_DIR, getHandoffFileSnippet, getMultiFileSnippet } from './utils/config';
