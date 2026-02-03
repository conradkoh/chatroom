/**
 * Agent Spawn Logic
 *
 * Spawns AI agent processes (OpenCode, Claude, Cursor) for remote start.
 * Init prompt is fetched from the backend (single source of truth).
 */

import { spawn } from 'node:child_process';

import { AGENT_TOOL_COMMANDS, type AgentTool } from '../../infrastructure/machine/index.js';

export interface SpawnOptions {
  /** Agent tool to spawn */
  tool: AgentTool;
  /** Working directory to run in */
  workingDir: string;
  /** Init prompt from backend (single source of truth) */
  initPrompt: string;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
}

/**
 * Spawn an agent process
 *
 * The agent is spawned in detached mode so it continues running
 * independently of the daemon process.
 *
 * @param options.tool - Agent tool to spawn (opencode, claude, cursor)
 * @param options.workingDir - Working directory to run in
 * @param options.initPrompt - Init prompt fetched from backend
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const { tool, workingDir, initPrompt } = options;
  const command = AGENT_TOOL_COMMANDS[tool];

  console.log(`   Spawning ${tool} agent...`);
  console.log(`   Working dir: ${workingDir}`);

  try {
    let childProcess;

    switch (tool) {
      case 'opencode':
        // OpenCode: Start interactive session
        // Pass init prompt via environment or stdin (OpenCode reads stdin on start)
        childProcess = spawn(command, [], {
          cwd: workingDir,
          stdio: ['pipe', 'inherit', 'inherit'],
          detached: true,
          shell: true,
        });
        // Write init prompt to stdin
        childProcess.stdin?.write(initPrompt);
        childProcess.stdin?.end();
        break;

      case 'claude':
        // Claude: First argument is the prompt
        childProcess = spawn(command, [initPrompt], {
          cwd: workingDir,
          stdio: 'inherit',
          detached: true,
          shell: true,
        });
        break;

      case 'cursor':
        // Cursor CLI uses 'agent chat' subcommand
        childProcess = spawn(command, ['chat', initPrompt], {
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
