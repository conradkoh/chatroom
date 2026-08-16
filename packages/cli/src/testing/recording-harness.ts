/**
 * RecordingHarness — test double for native harness resumeTurn injection.
 *
 * Captures prompts the daemon would inject via AgentProcessManager.resumeTurnForSlot.
 * Used by native orchestration tests without a live opencode-sdk / cursor-sdk process.
 */

import type { StopReason } from '../daemon/domain/entities/stop-reason.js';
import type { AgentHarness } from '../daemon/entry/daemon-types.js';
import type { NativeInjectorAgentMgr } from '../daemon/entry/native-delivery/native-task-injector.js';
import type { AgentSlot } from '../daemon/infrastructure/agent-process-manager/agent-process-manager.js';
import type { OperationResult } from '../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';

export interface RecordedInjection {
  chatroomId: string;
  role: string;
  prompt: string;
  at: number;
}

export class RecordingHarness implements NativeInjectorAgentMgr {
  readonly injections: RecordedInjection[] = [];
  harnessSessionId = 'sess_cold';

  resumeTurnForSlot = async (args: {
    chatroomId: string;
    role: string;
    prompt: string;
  }): Promise<void> => {
    this.injections.push({
      chatroomId: args.chatroomId,
      role: args.role,
      prompt: args.prompt,
      at: Date.now(),
    });
  };

  stop = async (_opts: {
    chatroomId: string;
    role: string;
    reason: StopReason;
  }): Promise<{ success: boolean }> => ({ success: true });

  ensureRunning = async (_opts: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    model: string;
    workingDir: string;
    reason: string;
    wantResume: boolean;
  }): Promise<OperationResult> => ({
    success: true,
    pid: 12345,
  });

  getSlot = (_chatroomId: string, _role: string): AgentSlot | undefined => ({
    state: 'running',
    harnessSessionId: this.harnessSessionId,
  });

  lastInjection(): RecordedInjection | undefined {
    return this.injections.at(-1);
  }

  promptsFor(role: string): string[] {
    return this.injections.filter((entry) => entry.role === role).map((entry) => entry.prompt);
  }

  reset(): void {
    this.injections.length = 0;
  }
}
