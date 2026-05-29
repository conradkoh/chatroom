/**
 * Harness capability configuration for remote agent runtimes.
 *
 * Each harness has a dedicated config file exporting its capabilities.
 * Use `getHarnessCapabilities()` for runtime lookup by `AgentHarness`.
 */

import type { AgentHarness } from '../agent.js';

import { claudeCapabilities } from './claude.config.js';
import { commandcodeCapabilities } from './commandcode.config.js';
import { copilotCapabilities } from './copilot.config.js';
import { cursorCapabilities } from './cursor.config.js';
import { cursorSdkCapabilities } from './cursor-sdk.config.js';
import { opencodeCapabilities } from './opencode.config.js';
import { opencodeSdkCapabilities } from './opencode-sdk.config.js';
import { piCapabilities } from './pi.config.js';

export interface HarnessCapabilities {
  /**
   * Whether this harness supports resuming a session after an agent_end turn
   * (instead of doing a full cold restart). When true, the daemon will call
   * service.resumeTurn() instead of killing and re-spawning the process.
   */
  supportsSessionResume: boolean;
}

const HARNESS_CAPABILITIES: Record<AgentHarness, HarnessCapabilities> = {
  claude: claudeCapabilities,
  commandcode: commandcodeCapabilities,
  copilot: copilotCapabilities,
  cursor: cursorCapabilities,
  'cursor-sdk': cursorSdkCapabilities,
  opencode: opencodeCapabilities,
  'opencode-sdk': opencodeSdkCapabilities,
  pi: piCapabilities,
};

export function getHarnessCapabilities(harness: AgentHarness): HarnessCapabilities {
  return HARNESS_CAPABILITIES[harness];
}
