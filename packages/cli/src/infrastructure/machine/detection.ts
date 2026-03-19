/**
 * Agent Harness Detection
 *
 * Detects which AI agent harnesses are installed on the current machine,
 * including version detection for compatibility gating.
 *
 * All detection is delegated to the harness registry — each RemoteAgentService
 * knows its own command and how to check installation / version.
 */

import type { AgentHarness, HarnessVersionInfo } from './types.js';
import {
  initHarnessRegistry,
  getAllHarnesses,
  getHarness,
} from '../services/remote-agents/index.js';

/**
 * Detect the version of a specific agent harness.
 * Returns null if version cannot be detected.
 */
export function detectHarnessVersion(harness: AgentHarness): HarnessVersionInfo | null {
  initHarnessRegistry();
  const info = getHarness(harness)?.getVersion();
  if (!info) return null;
  return { version: info.version, major: info.major };
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
 * Detect which agent harnesses are installed on this machine.
 *
 * @returns Array of available agent harnesses
 */
export function detectAvailableHarnesses(): AgentHarness[] {
  initHarnessRegistry();
  return getAllHarnesses()
    .filter((s) => s.isInstalled())
    .map((s) => s.id as AgentHarness);
}
