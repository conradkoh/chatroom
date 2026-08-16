/**
 * RecordingHarness — test double for native harness resumeTurn injection.
 *
 * Captures prompts the daemon would inject via AgentProcessManager.resumeTurnForSlot.
 * Used by native orchestration tests without a live opencode-sdk / cursor-sdk process.
 */

export interface RecordedInjection {
  chatroomId: string;
  role: string;
  prompt: string;
  at: number;
}

export class RecordingHarness {
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

  stop = async (): Promise<{ success: boolean }> => ({ success: true });

  ensureRunning = async (): Promise<{ success: boolean; pid: number }> => ({
    success: true,
    pid: 12345,
  });

  getSlot = (): { harnessSessionId: string } => ({ harnessSessionId: this.harnessSessionId });

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
