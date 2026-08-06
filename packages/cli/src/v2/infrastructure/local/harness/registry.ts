import { installDaemonFatalErrorGuard } from '../../../../infrastructure/daemon/fatal-error-guard.js';
import { ClaudeCodeAgentService } from '../../../../infrastructure/services/remote-agents/claude/index.js';
import { ClaudeSdkAgentService } from '../../../../infrastructure/services/remote-agents/claude-sdk/index.js';
import { CommandCodeAgentService } from '../../../../infrastructure/services/remote-agents/commandcode/index.js';
import { CopilotAgentService } from '../../../../infrastructure/services/remote-agents/copilot/index.js';
import { CursorAgentService } from '../../../../infrastructure/services/remote-agents/cursor/index.js';
import { CursorSdkAgentService } from '../../../../infrastructure/services/remote-agents/cursor-sdk/index.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import { OpenCodeSdkAgentService } from '../../../../infrastructure/services/remote-agents/opencode-sdk/index.js';
import { PiAgentService } from '../../../../infrastructure/services/remote-agents/pi/index.js';
import { PiSdkAgentService } from '../../../../infrastructure/services/remote-agents/pi-sdk/index.js';
import { registerHarness } from '../../../../infrastructure/services/remote-agents/registry.js';

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
