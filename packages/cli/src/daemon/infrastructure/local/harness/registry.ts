import { installDaemonFatalErrorGuard } from '../fatal-error-guard.js';
import { ClaudeCodeAgentService } from './services/claude/index.js';
import { ClaudeSdkAgentService } from './services/claude-sdk/index.js';
import { CommandCodeAgentService } from './services/commandcode/index.js';
import { CopilotAgentService } from './services/copilot/index.js';
import { CursorAgentService } from './services/cursor/index.js';
import { CursorSdkAgentService } from './services/cursor-sdk/index.js';
import { OpenCodeAgentService } from './services/opencode/index.js';
import { OpenCodeSdkAgentService } from './services/opencode-sdk/index.js';
import { PiAgentService } from './services/pi/index.js';
import { PiSdkAgentService } from './services/pi-sdk/index.js';
import { registerHarness } from './services/registry.js';

let initialized = false;

/** Populate the harness registry. Safe to call multiple times (idempotent). */
export function initHarnessRegistry(): void {
  if (initialized) return;
  installDaemonFatalErrorGuard();
  registerHarness(new OpenCodeAgentService());
  registerHarness(new OpenCodeSdkAgentService());
  registerHarness(new PiAgentService());
  registerHarness(new PiSdkAgentService());
  registerHarness(new CursorAgentService());
  registerHarness(new CursorSdkAgentService());
  registerHarness(new ClaudeCodeAgentService());
  registerHarness(new ClaudeSdkAgentService());
  registerHarness(new CommandCodeAgentService());
  registerHarness(new CopilotAgentService());
  initialized = true;
}
