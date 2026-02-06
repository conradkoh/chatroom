/**
 * OpenCode Process-Based Agent Driver
 *
 * Process-based driver for the OpenCode CLI using `opencode run`.
 * This is the Phase 1 implementation that wraps the existing spawn logic.
 * In Phase 4, this will be replaced by an SDK-based driver
 * (opencode-sdk-driver.ts) that supports session persistence.
 *
 * Uses `opencode run` for non-interactive (headless) mode with prompt
 * passed via stdin. Supports --model flag for model selection.
 */

import { buildCombinedPrompt, ProcessDriver, type SpawnConfig } from './process-driver.js';
import type { AgentCapabilities, AgentStartOptions } from './types.js';
import { AGENT_TOOL_COMMANDS } from '../machine/types.js';

/**
 * Static model list for OpenCode (fallback when dynamic discovery is unavailable).
 *
 * OpenCode models depend on the user's configured providers. These are
 * the commonly available models. In Phase 4 (SDK driver), this will be
 * replaced by dynamic discovery via the OpenCode API.
 */
const OPENCODE_MODELS: string[] = [
  'github-copilot/claude-sonnet-4.5',
  'github-copilot/claude-opus-4.6',
  'github-copilot/claude-opus-4.5',
  'github-copilot/gpt-5.2',
  'github-copilot/gpt-5.2-codex',
  'github-copilot/gpt-5.1-codex-max',
  'github-copilot/gemini-3-flash-preview',
  'github-copilot/claude-haiku-4.5',
  'opencode/big-pickle',
];

export class OpenCodeProcessDriver extends ProcessDriver {
  readonly tool = 'opencode' as const;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false, // Will become true in Phase 4 (SDK driver)
    abort: false, // Will become true in Phase 4 (SDK driver)
    modelSelection: true,
    compaction: false, // Will become true in Phase 4 (SDK driver)
    eventStreaming: false, // Will become true in Phase 4 (SDK driver)
    messageInjection: false, // Will become true in Phase 4 (SDK driver)
    dynamicModelDiscovery: false, // Will become true in Phase 4 (SDK driver)
  };

  protected buildSpawnConfig(options: AgentStartOptions): SpawnConfig {
    const command = AGENT_TOOL_COMMANDS[this.tool];
    const combinedPrompt = buildCombinedPrompt(options.rolePrompt, options.initialMessage);

    // OpenCode: use `opencode run` for non-interactive (headless) mode.
    const args: string[] = ['run'];
    if (options.model) {
      args.push('--model', options.model);
    }

    return {
      command,
      args,
      stdio: ['pipe', 'inherit', 'inherit'],
      writePromptToStdin: true,
      stdinPrompt: combinedPrompt,
    };
  }

  override async listModels(): Promise<string[]> {
    return OPENCODE_MODELS;
  }
}
