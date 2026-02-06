/**
 * Agent Spawn Logic — Backward Compatibility Wrapper
 *
 * @deprecated Use `getDriverRegistry()` from `infrastructure/agent-drivers` instead.
 *
 * This module now delegates to the unified driver registry.
 * The SpawnOptions/SpawnResult interfaces are preserved for callers that
 * haven't migrated yet (e.g. daemon-start.ts).
 *
 * Migration path (Phase 2):
 *   Before: import { spawnAgent } from './spawn.js';
 *   After:  import { getDriverRegistry } from '../../infrastructure/agent-drivers/index.js';
 *           const driver = getDriverRegistry().get(tool);
 *           const result = await driver.start(options);
 */

import { getDriverRegistry } from '../../infrastructure/agent-drivers/index.js';
import type { AgentTool, ToolVersionInfo } from '../../infrastructure/machine/index.js';

export interface SpawnOptions {
  /** Agent tool to spawn */
  tool: AgentTool;
  /** Working directory to run in */
  workingDir: string;
  /** Role prompt (identity, guidance, commands) — used as system prompt in machine mode */
  rolePrompt: string;
  /** Initial message (context-gaining, next steps) — used as first user message */
  initialMessage: string;
  /** Tool version info (for version-specific spawn logic) */
  toolVersion?: ToolVersionInfo;
  /** AI model to use (e.g. "github-copilot/claude-sonnet-4.5") */
  model?: string;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
}

/**
 * Spawn an agent process.
 *
 * @deprecated Delegates to the driver registry. Use getDriverRegistry().get(tool).start() directly.
 *
 * Preserved for backward compatibility with daemon-start.ts and other callers.
 * The driver registry produces identical behavior — same process spawn, same
 * detach/unref, same stdin prompt delivery — so this is a zero-behavior-change migration.
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const { tool, workingDir, rolePrompt, initialMessage, toolVersion, model } = options;

  const registry = getDriverRegistry();

  let driver;
  try {
    driver = registry.get(tool);
  } catch {
    return {
      success: false,
      message: `Unknown agent tool: ${tool}`,
    };
  }

  const result = await driver.start({
    workingDir,
    rolePrompt,
    initialMessage,
    toolVersion,
    model,
  });

  return {
    success: result.success,
    message: result.message,
    pid: result.handle?.pid,
  };
}
