import { ClaudeCodeAgentService } from './claude/index.js';
import { ClaudeSdkAgentService } from './claude-sdk/index.js';
import { CommandCodeAgentService } from './commandcode/index.js';
import { CopilotAgentService } from './copilot/index.js';
import { CursorAgentService } from './cursor/index.js';
import { CursorSdkAgentService } from './cursor-sdk/index.js';
import { OpenCodeAgentService } from './opencode/index.js';
import { OpenCodeSdkAgentService } from './opencode-sdk/index.js';
import { PiAgentService } from './pi/index.js';
import { PiSdkAgentService } from './pi-sdk/index.js';
import { registerHarness } from './registry.js';
import { installDaemonFatalErrorGuard } from '../../daemon/fatal-error-guard.js';

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
