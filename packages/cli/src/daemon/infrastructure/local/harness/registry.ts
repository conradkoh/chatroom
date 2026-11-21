import { installDaemonFatalErrorGuard } from '../fatal-error-guard.js';
import { ClaudeSdkAgentService } from './services/claude-sdk/index.js';
import { CodexSdkAgentService } from './services/codex-sdk/index.js';
import { CursorSdkAgentService } from './services/cursor-sdk/index.js';
import { OpenCodeSdkAgentService } from './services/opencode-sdk/index.js';
import { PiSdkAgentService } from './services/pi-sdk/index.js';
import { registerHarness } from './services/registry.js';

let initialized = false;

/** Populate the harness registry. Safe to call multiple times (idempotent). */
export function initHarnessRegistry(): void {
  if (initialized) return;
  installDaemonFatalErrorGuard();
  registerHarness(new OpenCodeSdkAgentService());
  registerHarness(new PiSdkAgentService());
  registerHarness(new CursorSdkAgentService());
  registerHarness(new ClaudeSdkAgentService());
  registerHarness(new CodexSdkAgentService());
  initialized = true;
}
