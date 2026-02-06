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

import { execSync } from 'node:child_process';

import { buildCombinedPrompt, ProcessDriver, type SpawnConfig } from './process-driver.js';
import type { AgentCapabilities, AgentStartOptions } from './types.js';
import { AGENT_TOOL_COMMANDS } from '../machine/types.js';

export class OpenCodeProcessDriver extends ProcessDriver {
  readonly tool = 'opencode' as const;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false, // Will become true in Phase 4 (SDK driver)
    abort: false, // Will become true in Phase 4 (SDK driver)
    modelSelection: true,
    compaction: false, // Will become true in Phase 4 (SDK driver)
    eventStreaming: false, // Will become true in Phase 4 (SDK driver)
    messageInjection: false, // Will become true in Phase 4 (SDK driver)
    dynamicModelDiscovery: true,
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

  /**
   * Discover available models by running `opencode models`.
   * Returns one model ID per line (provider/model-id format).
   * Falls back to empty array if the command fails.
   */
  override async listModels(): Promise<string[]> {
    try {
      const output = execSync('opencode models', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })
        .toString()
        .trim();

      if (!output) return [];

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }
}
