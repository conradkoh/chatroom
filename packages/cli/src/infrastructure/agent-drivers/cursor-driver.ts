/**
 * Cursor CLI Agent Driver
 *
 * Process-based driver for the Cursor CLI.
 * Uses `agent chat --file <prompt-file>` with the prompt written
 * to a temp file to avoid argument length limits.
 */

import {
  buildCombinedPrompt,
  ProcessDriver,
  scheduleCleanup,
  writeTempPromptFile,
  type SpawnConfig,
} from './process-driver.js';
import type { AgentCapabilities, AgentStartOptions } from './types.js';
import { AGENT_TOOL_COMMANDS } from '../machine/types.js';

export class CursorDriver extends ProcessDriver {
  readonly tool = 'cursor' as const;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false,
    abort: false,
    modelSelection: false,
    compaction: false,
    eventStreaming: false,
    messageInjection: false,
    dynamicModelDiscovery: false,
  };

  protected buildSpawnConfig(options: AgentStartOptions): SpawnConfig {
    const command = AGENT_TOOL_COMMANDS[this.tool];
    const combinedPrompt = buildCombinedPrompt(options.rolePrompt, options.initialMessage);

    // Cursor CLI: write prompt to temp file to avoid arg length limits.
    const promptFile = writeTempPromptFile(combinedPrompt);

    return {
      command,
      args: ['chat', '--file', promptFile],
      stdio: 'inherit',
      writePromptToStdin: false,
      afterSpawn: () => {
        // Schedule cleanup of the temp file after the process has had time to read it
        scheduleCleanup(promptFile, 10000);
      },
    };
  }
}
