/**
 * Agent Harness Detection
 *
 * Detects which AI agent harnesses are installed on the current machine,
 * including version detection for compatibility gating.
 */

import { execSync } from 'node:child_process';

import {
  AGENT_HARNESSES,
  AGENT_HARNESS_COMMANDS,
  type AgentHarness,
  type HarnessVersionInfo,
} from './types.js';

/**
 * Version detection commands for each harness.
 * Returns null if version detection is not supported for a harness.
 */
const HARNESS_VERSION_COMMANDS: Partial<Record<AgentHarness, string>> = {
  opencode: 'opencode --version',
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
function parseVersion(versionStr: string): HarnessVersionInfo | null {
  // Match patterns like "1.2.3", "v1.2.3", "1.0.0-beta.1"
  const match = versionStr.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  const major = parseInt(match[1], 10);
  const version = `${match[1]}.${match[2]}.${match[3]}`;

  return { version, major };
}

/**
 * Detect the version of a specific agent harness.
 * Returns null if version cannot be detected.
 */
export function detectHarnessVersion(harness: AgentHarness): HarnessVersionInfo | null {
  const versionCommand = HARNESS_VERSION_COMMANDS[harness];
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
 * Detect versions for all provided harnesses.
 * Returns a partial record (only harnesses with detectable versions).
 */
export function detectHarnessVersions(
  harnesses: AgentHarness[]
): Partial<Record<AgentHarness, HarnessVersionInfo>> {
  const versions: Partial<Record<AgentHarness, HarnessVersionInfo>> = {};

  for (const harness of harnesses) {
    const version = detectHarnessVersion(harness);
    if (version) {
      versions[harness] = version;
    }
  }

  return versions;
}

/**
 * Detect which agent harnesses are installed on this machine
 *
 * Checks for:
 * - opencode: OpenCode CLI
 *
 * @returns Array of available agent harnesses
 */
export function detectAvailableHarnesses(): AgentHarness[] {
  const available: AgentHarness[] = [];

  for (const harness of AGENT_HARNESSES) {
    const command = AGENT_HARNESS_COMMANDS[harness];
    if (commandExists(command)) {
      available.push(harness);
    }
  }

  return available;
}

/**
 * Check if a specific agent harness is available
 */
export function isHarnessAvailable(harness: AgentHarness): boolean {
  const command = AGENT_HARNESS_COMMANDS[harness];
  return commandExists(command);
}
