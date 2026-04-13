import { ClaudeCodeAgentService } from './claude/index.js';
import { CopilotAgentService } from './copilot/index.js';
import { CursorAgentService } from './cursor/index.js';
import { OpenCodeAgentService } from './opencode/index.js';
import { PiAgentService } from './pi/index.js';
import { registerHarness } from './registry.js';

let initialized = false;

/** Populate the harness registry. Safe to call multiple times (idempotent). */
export function initHarnessRegistry(): void {
  if (initialized) return;
  registerHarness(new OpenCodeAgentService());
  registerHarness(new PiAgentService());
  registerHarness(new CursorAgentService());
  registerHarness(new ClaudeCodeAgentService());
  registerHarness(new CopilotAgentService());
  initialized = true;
}
