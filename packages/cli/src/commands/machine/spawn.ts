/**
 * Agent Spawn Logic
 *
 * Spawns AI agent processes (OpenCode, Claude, Cursor) for remote start.
 * Supports split prompts: role prompt as system prompt, initial message as user message.
 *
 * Start modes:
 * - "machine" mode (daemon-controlled): Uses split prompts where rolePrompt is
 *   injected as the system prompt and initialMessage is the first user message.
 * - "manual" mode: Uses the combined init prompt as a single user message.
 */

import { spawn } from 'node:child_process';

import {
  AGENT_TOOL_COMMANDS,
  type AgentTool,
  type ToolVersionInfo,
} from '../../infrastructure/machine/index.js';

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
  /** AI model to use (e.g. "claude-sonnet-4-20250514", "o3") */
  model?: string;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
}

/**
 * Spawn an OpenCode agent.
 * For v1.x: passes combined prompt via stdin (no system prompt support).
 * Future v2.x: could use --system-prompt flag or similar.
 */
function spawnOpenCode(
  command: string,
  workingDir: string,
  rolePrompt: string,
  initialMessage: string,
  toolVersion?: ToolVersionInfo,
  model?: string
) {
  const majorVersion = toolVersion?.major ?? 1;

  if (majorVersion >= 2) {
    // Future: OpenCode v2.x may support --system-prompt or similar
    // For now, fall through to v1.x behavior
    console.log(`   OpenCode v${toolVersion?.version} detected (v2+ path - placeholder)`);
  }

  // v1.x: OpenCode reads stdin on start, combine prompts for now
  // In the future, rolePrompt can be passed as a system prompt flag
  const combinedPrompt = `${rolePrompt}\n\n${initialMessage}`;

  // Build args: opencode supports --model flag
  const args: string[] = [];
  if (model) {
    args.push('--model', model);
  }

  const childProcess = spawn(command, args, {
    cwd: workingDir,
    stdio: ['pipe', 'inherit', 'inherit'],
    detached: true,
    shell: true,
  });
  childProcess.stdin?.write(combinedPrompt);
  childProcess.stdin?.end();

  return childProcess;
}

/**
 * Spawn an agent process
 *
 * The agent is spawned in detached mode so it continues running
 * independently of the daemon process.
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const { tool, workingDir, rolePrompt, initialMessage, toolVersion, model } = options;
  const command = AGENT_TOOL_COMMANDS[tool];

  console.log(`   Spawning ${tool} agent...`);
  console.log(`   Working dir: ${workingDir}`);
  if (toolVersion) {
    console.log(`   Tool version: v${toolVersion.version} (major: ${toolVersion.major})`);
  }
  if (model) {
    console.log(`   Model: ${model}`);
  }

  try {
    let childProcess;

    // Combined prompt for tools that don't support separate system prompts
    const combinedPrompt = `${rolePrompt}\n\n${initialMessage}`;

    switch (tool) {
      case 'opencode':
        childProcess = spawnOpenCode(
          command,
          workingDir,
          rolePrompt,
          initialMessage,
          toolVersion,
          model
        );
        break;

      case 'claude': {
        // Claude Code: First argument is the prompt (combined for now)
        // Supports --model flag
        const claudeArgs = ['--print', combinedPrompt];
        if (model) {
          claudeArgs.unshift('--model', model);
        }
        childProcess = spawn(command, claudeArgs, {
          cwd: workingDir,
          stdio: 'inherit',
          detached: true,
          shell: true,
        });
        break;
      }

      case 'cursor':
        // Cursor CLI uses 'agent chat' subcommand
        // No model flag support currently
        childProcess = spawn(command, ['chat', combinedPrompt], {
          cwd: workingDir,
          stdio: 'inherit',
          detached: true,
          shell: true,
        });
        break;

      default:
        return {
          success: false,
          message: `Unknown agent tool: ${tool}`,
        };
    }

    // Unref so parent can exit independently
    childProcess.unref();

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if process is still running (didn't immediately crash)
    if (childProcess.killed || childProcess.exitCode !== null) {
      return {
        success: false,
        message: `Agent process exited immediately (exit code: ${childProcess.exitCode})`,
      };
    }

    return {
      success: true,
      message: `Agent spawned successfully`,
      pid: childProcess.pid,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to spawn agent: ${(error as Error).message}`,
    };
  }
}
