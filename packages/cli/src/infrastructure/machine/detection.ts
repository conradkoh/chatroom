/**
 * Agent Tool Detection
 *
 * Detects which AI agent tools are installed on the current machine,
 * including version detection for compatibility gating.
 */

import { execSync } from 'node:child_process';

import { AGENT_TOOLS, AGENT_TOOL_COMMANDS, type AgentTool, type ToolVersionInfo } from './types.js';

/**
 * Version detection commands for each tool.
 * Returns null if version detection is not supported for a tool.
 */
const TOOL_VERSION_COMMANDS: Partial<Record<AgentTool, string>> = {
  opencode: 'opencode version',
  claude: 'claude --version',
};

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
 * Parse a version string like "1.2.3" or "v1.2.3" into structured info.
 * Returns null if the version string cannot be parsed.
 */
function parseVersion(versionStr: string): ToolVersionInfo | null {
  // Match patterns like "1.2.3", "v1.2.3", "1.0.0-beta.1"
  const match = versionStr.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  const major = parseInt(match[1], 10);
  const version = `${match[1]}.${match[2]}.${match[3]}`;

  return { version, major };
}

/**
 * Detect the version of a specific agent tool.
 * Returns null if version cannot be detected.
 */
export function detectToolVersion(tool: AgentTool): ToolVersionInfo | null {
  const versionCommand = TOOL_VERSION_COMMANDS[tool];
  if (!versionCommand) return null;

  try {
    const output = execSync(versionCommand, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
      .toString()
      .trim();

    return parseVersion(output);
  } catch {
    return null;
  }
}

/**
 * Detect versions for all provided tools.
 * Returns a partial record (only tools with detectable versions).
 */
export function detectToolVersions(
  tools: AgentTool[]
): Partial<Record<AgentTool, ToolVersionInfo>> {
  const versions: Partial<Record<AgentTool, ToolVersionInfo>> = {};

  for (const tool of tools) {
    const version = detectToolVersion(tool);
    if (version) {
      versions[tool] = version;
    }
  }

  return versions;
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
