/**
 * Agent Spawn Logic
 *
 * Spawns AI agent processes (OpenCode, Claude, Cursor) for remote start.
 */

import { spawn } from 'node:child_process';

import { AGENT_TOOL_COMMANDS, type AgentTool } from '../../infrastructure/machine/index.js';

export interface SpawnOptions {
  /** Agent tool to spawn */
  tool: AgentTool;
  /** Working directory to run in */
  workingDir: string;
  /** Chatroom ID for init prompt */
  chatroomId: string;
  /** Role for init prompt */
  role: string;
}

export interface SpawnResult {
  success: boolean;
  message: string;
  pid?: number;
}

/**
 * Build the init prompt for an agent
 */
function buildInitPrompt(chatroomId: string, role: string): string {
  // The init prompt tells the agent to connect to the chatroom
  return `# Pair Team

## Your Role: ${role.toUpperCase()}

You are the ${role} in a pair team workflow.

## Getting Started

### Step 1: Gain Context

Before waiting for tasks, understand the conversation history:

\`\`\`bash
chatroom context read --chatroom-id=${chatroomId} --role=${role}
\`\`\`

This shows:
- Origin message and classification
- Full conversation history
- Pending tasks for your role
- Current work status

### Step 2: Wait for Tasks

After gaining context, run:

\`\`\`bash
chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}
\`\`\`

The CLI will provide:
- Detailed workflow instructions
- Command examples
- Role-specific guidance
- Team collaboration patterns

## Next Steps

1. Copy the **context read** command above
2. Review the conversation history
3. Run **wait-for-task** to receive your first task
4. Follow the detailed instructions provided by the CLI
`;
}

/**
 * Spawn an agent process
 *
 * The agent is spawned in detached mode so it continues running
 * independently of the daemon process.
 */
export async function spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
  const { tool, workingDir, chatroomId, role } = options;
  const command = AGENT_TOOL_COMMANDS[tool];
  const initPrompt = buildInitPrompt(chatroomId, role);

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
