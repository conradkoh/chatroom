/**
 * OpenCodeProcessDriver — AgentToolDriver for the OpenCode CLI harness.
 *
 * Wraps `opencode run [--model <model>]` invocation, writing the combined
 * system + user prompt to stdin. This preserves exactly the behavior that
 * was previously in OpenCodeAgentService.spawn().
 *
 * Capabilities:
 * - modelSelection: true (supports --model flag)
 * - All session/streaming capabilities: false (CLI process, no SDK)
 */

import { execSync, spawn } from 'node:child_process';

import { ProcessAgentDriver, type ProcessDriverDeps } from './process-driver.js';
import type { AgentCapabilities, AgentStartOptions } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface OpenCodeProcessDriverDeps extends ProcessDriverDeps {
  execSync: (cmd: string, options?: object) => Buffer;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

export class OpenCodeProcessDriver extends ProcessAgentDriver {
  readonly harness = 'opencode' as const;
  protected readonly command = OPENCODE_COMMAND;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false,
    abort: false,
    modelSelection: true,
    compaction: false,
    eventStreaming: false,
    messageInjection: false,
    dynamicModelDiscovery: false,
  };

  private readonly execSyncFn: (cmd: string, options?: object) => Buffer;

  constructor(deps?: Partial<OpenCodeProcessDriverDeps>) {
    const { execSync: execSyncDep, ...processDeps } = {
      execSync,
      spawn,
      kill: (pid: number, signal: number | string) => process.kill(pid, signal),
      ...deps,
    };
    super(processDeps);
    this.execSyncFn = execSyncDep;
  }

  protected buildArgs(options: AgentStartOptions): string[] {
    return this.buildArgsForService(options.model);
  }

  /**
   * Public helper for OpenCodeAgentService to build the CLI args array.
   * Exposed so the service can delegate arg-building without going through start().
   */
  buildArgsForService(model?: string): string[] {
    const args: string[] = ['run'];
    if (model) {
      args.push('--model', model);
    }
    return args;
  }

  /**
   * Public helper for OpenCodeAgentService to build the full prompt string.
   * Exposed so the service can delegate prompt-building without going through start().
   */
  buildPromptForService(systemPrompt: string | undefined, prompt: string): string {
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  }

  async listModels(): Promise<string[]> {
    try {
      const output = this.execSyncFn(`${OPENCODE_COMMAND} models`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })
        .toString()
        .trim();

      if (!output) return [];

      return output
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);
    } catch {
      return [];
    }
  }
}
