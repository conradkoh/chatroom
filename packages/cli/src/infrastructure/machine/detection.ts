/**
 * Agent Tool Detection
 *
 * Detects which AI agent tools are installed on the current machine.
 */

import { execSync } from 'node:child_process';

import { AGENT_TOOLS, AGENT_TOOL_COMMANDS, type AgentTool } from './types.js';

/**
 * Check if a command exists in the system PATH
 */
function commandExists(command: string): boolean {
  try {
    // Use 'which' on Unix-like systems, 'where' on Windows
    const checkCommand = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    execSync(checkCommand, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which agent tools are installed on this machine
 *
 * Checks for:
 * - opencode: OpenCode CLI
 * - claude: Claude Code CLI
 * - cursor: Cursor CLI (uses 'agent' command)
 *
 * @returns Array of available agent tools
 */
export function detectAvailableTools(): AgentTool[] {
  const available: AgentTool[] = [];

  for (const tool of AGENT_TOOLS) {
    const command = AGENT_TOOL_COMMANDS[tool];
    if (commandExists(command)) {
      available.push(tool);
    }
  }

  return available;
}

/**
 * Check if a specific agent tool is available
 */
export function isToolAvailable(tool: AgentTool): boolean {
  const command = AGENT_TOOL_COMMANDS[tool];
  return commandExists(command);
}
