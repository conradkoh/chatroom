/**
 * Claude Code Agent Driver
 *
 * Process-based driver for the Claude Code CLI.
 * Uses `claude --print` with prompt passed via stdin.
 * Supports model selection via the --model flag.
 */

import { buildCombinedPrompt, ProcessDriver, type SpawnConfig } from './process-driver.js';
import type { AgentCapabilities, AgentStartOptions } from './types.js';
import { AGENT_TOOL_COMMANDS } from '../machine/types.js';

/**
 * Static model list for Claude Code.
 * Claude's model selection is handled by Anthropic's API key and account,
 * so dynamic discovery is not currently supported.
 */
const CLAUDE_MODELS: string[] = [];

export class ClaudeDriver extends ProcessDriver {
  readonly tool = 'claude' as const;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false,
    abort: false,
    modelSelection: true,
    compaction: false,
    eventStreaming: false,
    messageInjection: false,
    dynamicModelDiscovery: false,
  };

  protected buildSpawnConfig(options: AgentStartOptions): SpawnConfig {
    const command = AGENT_TOOL_COMMANDS[this.tool];
    const combinedPrompt = buildCombinedPrompt(options.rolePrompt, options.initialMessage);

    // Claude Code: pass prompt via stdin with --print flag.
    const args = ['--print'];
    if (options.model) {
      args.unshift('--model', options.model);
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
    return CLAUDE_MODELS;
  }
}
