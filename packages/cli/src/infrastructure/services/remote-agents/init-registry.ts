import { registerHarness } from './registry.js';
import { OpenCodeAgentService } from './opencode/index.js';
import { PiAgentService } from './pi/index.js';
import { CursorAgentService } from './cursor/index.js';

let initialized = false;

/** Populate the harness registry. Safe to call multiple times (idempotent). */
export function initHarnessRegistry(): void {
  if (initialized) return;
  registerHarness(new OpenCodeAgentService());
  registerHarness(new PiAgentService());
  registerHarness(new CursorAgentService());
  initialized = true;
}
