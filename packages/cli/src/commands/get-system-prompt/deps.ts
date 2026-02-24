/**
 * Get System Prompt Deps — dependency interfaces for the get-system-prompt command.
 *
 * Uses BackendOps and SessionOps for fetching the agent system prompt.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/**
 * All external dependencies for the get-system-prompt command.
 */
export interface GetSystemPromptDeps {
  backend: BackendOps;
  session: SessionOps;
}
