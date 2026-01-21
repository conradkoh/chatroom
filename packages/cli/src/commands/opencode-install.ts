/**
 * OpenCode Tool Installation
 *
 * This module installs the chatroom CLI as an OpenCode tool, providing structured
 * command interfaces that avoid timeout issues with long-running bash commands.
 *
 * The tool is installed to ~/.config/opencode/tool/chatroom.ts
 */

export interface ToolInstallOptions {
  checkExisting?: boolean;
}

export interface ToolInstallResult {
  success: boolean;
  toolPath?: string;
  message: string;
}

/**
 * Check if chatroom CLI is installed
 */
async function isChatroomInstalled(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('chatroom --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install chatroom as an OpenCode tool
 */
export async function installTool(options: ToolInstallOptions = {}): Promise<ToolInstallResult> {
  const { checkExisting = true } = options;
  const os = await import('os');
  const fs = await import('fs/promises');
  const path = await import('path');

  const homeDir = os.homedir();
  const toolDir = path.join(homeDir, '.config', 'opencode', 'tool');
  const toolPath = path.join(toolDir, 'chatroom.ts');

  // Generate the tool content
  const toolContent = `import { tool } from "@opencode-ai/plugin";

/**
 * Check if chatroom CLI is installed and authenticated
 */
async function checkChatroomStatus(): Promise<{ installed: boolean; authenticated: boolean; error?: string }> {
  try {
    // Check if chatroom is installed
    const versionProc = Bun.spawn(['chatroom', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    await versionProc.exited;
    if (versionProc.exitCode !== 0) {
      return { installed: false, authenticated: false, error: 'Chatroom CLI not found' };
    }

    // Check authentication status
    const authProc = Bun.spawn(['chatroom', 'auth', 'status'], { stdout: 'pipe', stderr: 'pipe' });
    const authOutput = await new Response(authProc.stdout).text();
    await authProc.exited;
    
    const authenticated = authProc.exitCode === 0 && authOutput.includes('✅');
    
    return { installed: true, authenticated };
  } catch (error) {
    return { installed: false, authenticated: false, error: String(error) };
  }
}

export default tool({
  description:
    "Wait for tasks in a multi-agent chatroom. This command joins a chatroom with a specific role and waits for tasks to be assigned. It's a long-running operation that polls for pending tasks and handles the complete workflow including authentication, task claiming, and graceful interruption handling. Use this instead of bash 'chatroom wait-for-task' to avoid timeout issues.",
  args: {
    chatroomId: tool.schema
      .string()
      .describe(
        "The chatroom ID to join. This is a unique identifier provided when the chatroom is created (e.g., 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2')."
      ),
    role: tool.schema
      .string()
      .describe(
        "Your role in the chatroom (e.g., 'builder', 'reviewer', 'architect'). This determines which tasks you'll receive and which agents you can hand off to."
      ),
    session: tool.schema
      .number()
      .optional()
      .describe(
        "Current session number for tracking progress across multiple wait sessions. Default is 1. Increment this when restarting after a session timeout to maintain context."
      ),
    duration: tool.schema
      .string()
      .optional()
      .describe(
        "How long to wait for tasks before timing out (e.g., '1m', '5m', '30s', '1h'). Default is 10 minutes. After timeout, you'll need to restart with the next session number."
      ),
    webUrl: tool.schema
      .string()
      .optional()
      .describe(
        "Override the web URL for local development (e.g., 'http://localhost:6249'). If not provided, uses the default production URL or environment variable CHATROOM_WEB_URL."
      ),
    convexUrl: tool.schema
      .string()
      .optional()
      .describe(
        "Override the Convex backend URL for local development (e.g., 'https://wonderful-raven-192.convex.cloud'). If not provided, uses the default production URL or environment variable CHATROOM_CONVEX_URL."
      ),
  },
  async execute(args) {
    // Check chatroom installation and authentication
    const status = await checkChatroomStatus();

    if (!status.installed) {
      return \`Error: Chatroom CLI is not installed.

Please install the chatroom CLI globally:
  npm install -g @chatroom/cli@latest

(Adapt the command for your preferred package manager)\`;
    }

    if (!status.authenticated) {
      return \`Error: Chatroom CLI is not authenticated.

Please authenticate the CLI:
  chatroom auth login

After logging in, try this command again.\`;
    }

    // Build command arguments
    const cmdArgs = ['wait-for-task', args.chatroomId, '--role', args.role];

    if (args.session !== undefined) {
      cmdArgs.push('--session', String(args.session));
    }

    if (args.duration !== undefined) {
      cmdArgs.push('--duration', args.duration);
    }

    // Build environment variables for local development
    const env: Record<string, string> = { ...process.env };
    
    if (args.webUrl) {
      env.CHATROOM_WEB_URL = args.webUrl;
    }
    
    if (args.convexUrl) {
      env.CHATROOM_CONVEX_URL = args.convexUrl;
    }

    // Execute the wait-for-task command
    // This is a long-running operation that polls for tasks
    const proc = Bun.spawn(['chatroom', ...cmdArgs], { 
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });

    // Capture both stdout and stderr
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    // Wait for the process to complete
    await proc.exited;

    // Combine output
    const output = [stdout, stderr].filter(s => s.trim()).join('\\n\\n');

    if (proc.exitCode !== 0) {
      return \`Error: Command failed with exit code \${proc.exitCode}\\n\\n\${output}\`;
    }

    return output.trim();
  },
});
`;

  try {
    // Check if tool already exists
    if (checkExisting) {
      try {
        await fs.access(toolPath);
        const message = `Tool already exists at: ${toolPath}

To reinstall, delete the existing file first:
  rm ${toolPath}

Then run this command again.`;
        console.log(message);
        return {
          success: false,
          message,
        };
      } catch {
        // Tool doesn't exist, continue with installation
      }
    }

    // Check if chatroom CLI is installed
    const installed = await isChatroomInstalled();
    if (!installed) {
      const message = `⚠️  Chatroom CLI is not installed.

Please install the chatroom CLI globally first:
  npm install -g @chatroom/cli@latest

After installation, run this command again.`;
      console.log(message);
      return {
        success: false,
        message,
      };
    }

    // Create directory if it doesn't exist
    await fs.mkdir(toolDir, { recursive: true });

    // Write the tool file
    await fs.writeFile(toolPath, toolContent, 'utf-8');

    const message = `✅ Installed chatroom OpenCode tool successfully!

Location: ${toolPath}

The following command is now available in OpenCode:
  • wait-for-task - Join chatroom and wait for tasks (no more timeouts!)

The tool will automatically check for:
  ✓ Chatroom CLI installation
  ✓ Authentication status

For local development, you can pass custom URLs:
  • webUrl - Override CHATROOM_WEB_URL (e.g., 'http://localhost:6249')
  • convexUrl - Override CHATROOM_CONVEX_URL (e.g., 'https://your-dev.convex.cloud')

If you're not authenticated, run:
  chatroom auth login`;

    console.log(message);

    return {
      success: true,
      toolPath,
      message,
    };
  } catch (error) {
    const message = `❌ Error installing OpenCode tool: ${error}`;
    console.error(message);

    return {
      success: false,
      message,
    };
  }
}
