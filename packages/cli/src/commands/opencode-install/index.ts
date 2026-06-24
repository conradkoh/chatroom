/**
 * OpenCode Tool Installation
 *
 * This module installs the chatroom CLI as an OpenCode tool, providing structured
 * command interfaces that avoid timeout issues with long-running bash commands.
 *
 * The tool is installed to ~/.config/opencode/tool/chatroom.ts
 *
 * IMPORTANT: All tools in this file should include the following optional parameters
 * to support local development:
 *   - webUrl: Override the web URL (CHATROOM_WEB_URL)
 *   - convexUrl: Override the Convex backend URL (CHATROOM_CONVEX_URL)
 *
 * These parameters allow agents to connect to local development servers instead of
 * production when testing or developing.
 *
 * Phase 8: Migrated to Effect-TS services with typed error handling.
 */

import * as os from 'os';
import * as path from 'path';

import { Effect, Layer } from 'effect';

import type { OpenCodeInstallDeps } from './deps.js';
import { OpenCodeInstallFsService } from './opencode-install-fs-service.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { OpenCodeInstallDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolInstallOptions {
  checkExisting?: boolean;
}

export interface ToolInstallResult {
  success: boolean;
  toolPath?: string;
  message: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type InstallToolError =
  | { readonly _tag: 'ToolsAlreadyExist'; readonly paths: string[] }
  | { readonly _tag: 'ChatroomNotInstalled' }
  | { readonly _tag: 'FsError'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function isChatroomInstalledDefault(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('chatroom --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function createDefaultDeps(): Promise<OpenCodeInstallDeps> {
  const client = await getConvexClient();
  const fs = await import('fs/promises');
  return {
    backend: {
      mutation: (endpoint: any, args: any) => client.mutation(endpoint, args),
      query: (endpoint: any, args: any) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
    fs: {
      access: async (p) => {
        await fs.access(p);
      },
      mkdir: async (p, options) => {
        await fs.mkdir(p, options);
      },
      writeFile: async (p, content, encoding) => {
        await fs.writeFile(p, content, encoding);
      },
    },
    isChatroomInstalled: isChatroomInstalledDefault,
  };
}

/**
 * Build Effect Layer from OpenCodeInstallDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: OpenCodeInstallDeps): Layer.Layer<OpenCodeInstallFsService> {
  return Layer.succeed(OpenCodeInstallFsService, {
    access: (p) =>
      Effect.tryPromise({
        try: () => deps.fs.access(p),
        catch: () => new Error(''),
      }).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
      ),
    mkdir: (p, options) =>
      Effect.tryPromise({
        try: () => deps.fs.mkdir(p, options),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    writeFile: (p, content, enc) =>
      Effect.tryPromise({
        try: () => deps.fs.writeFile(p, content, enc as BufferEncoding),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    isChatroomInstalled: () => Effect.promise(() => deps.isChatroomInstalled()),
  });
}

// ─── Tool Content ──────────────────────────────────────────────────────────

// Generate the get-next-task tool content
const TOOL_CONTENT = `import { tool } from "@opencode-ai/plugin";

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
    "Get next task in a multi-agent chatroom. This command joins a chatroom with a specific role and waits for tasks to be assigned. It's a long-running operation that polls for pending tasks and handles the complete workflow including authentication, task claiming, and graceful interruption handling. Use this instead of bash 'chatroom get-next-task' to avoid timeout issues.",
  args: {
    chatroomId: tool.schema
      .string()
      .describe(
        "The chatroom ID to join. This is a unique identifier provided when the chatroom is created (e.g., 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2')."
      ),
    role: tool.schema
      .string()
      .describe(
        "Your role in the chatroom (e.g., 'builder', 'planner', 'architect'). This determines which tasks you'll receive and which agents you can hand off to."
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
    const cmdArgs = ['get-next-task', args.chatroomId, '--role', args.role];

    if (args.duration !== undefined) {
      cmdArgs.push('--duration', args.duration);
    }

    // Build environment variables for local development
    const env: Record<string, string | undefined> = { ...process.env };
    
    if (args.webUrl) {
      env.CHATROOM_WEB_URL = args.webUrl;
    }
    
    if (args.convexUrl) {
      env.CHATROOM_CONVEX_URL = args.convexUrl;
    }

    // Execute the get-next-task command
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

// Generate the handoff tool content
const HANDOFF_TOOL_CONTENT = `import { tool } from "@opencode-ai/plugin";

/**
 * Chatroom Handoff Tool
 *
 * IMPORTANT: All chatroom tools should include the following optional parameters
 * to support local development:
 *   - webUrl: Override the web URL (CHATROOM_WEB_URL)
 *   - convexUrl: Override the Convex backend URL (CHATROOM_CONVEX_URL)
 *
 * These parameters allow agents to connect to local development servers instead of
 * production when testing or developing.
 */

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
    "Complete your task and hand off to the next role in a multi-agent chatroom. Use this to pass work to another agent (planner, architect, etc.) or back to the user. The message should summarize what you accomplished and any relevant context for the next agent.",
  args: {
    chatroomId: tool.schema
      .string()
      .describe(
        "The chatroom ID to hand off in. This is a unique identifier provided when the chatroom is created (e.g., 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2')."
      ),
    role: tool.schema
      .string()
      .describe(
        "Your role in the chatroom (e.g., 'builder', 'planner', 'architect'). This identifies who is performing the handoff."
      ),
    message: tool.schema
      .string()
      .describe(
        "A markdown-formatted summary of what you accomplished. Include relevant details like files changed, decisions made, and any context the next agent needs."
      ),
    nextRole: tool.schema
      .string()
      .describe(
        "The role to hand off to (e.g., 'planner', 'user', 'architect'). Use 'user' to return control to the user."
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
    const cmdArgs = [
      'handoff',
      args.chatroomId,
      '--role', args.role,
      '--message', args.message,
      '--next-role', args.nextRole,
    ];

    // Build environment variables for local development
    const env: Record<string, string | undefined> = { ...process.env };
    
    if (args.webUrl) {
      env.CHATROOM_WEB_URL = args.webUrl;
    }
    
    if (args.convexUrl) {
      env.CHATROOM_CONVEX_URL = args.convexUrl;
    }

    // Execute the handoff command
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

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for installing the chatroom OpenCode tool.
 * No process.exit inside — typed errors only; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const installToolEffect = (
  options: ToolInstallOptions = {}
): Effect.Effect<ToolInstallResult, InstallToolError, OpenCodeInstallFsService> =>
  Effect.gen(function* () {
    const fsService = yield* OpenCodeInstallFsService;
    const { checkExisting = true } = options;

    const homeDir = os.homedir();
    const toolDir = path.join(homeDir, '.config', 'opencode', 'tool');
    const toolPath = path.join(toolDir, 'chatroom.ts');
    const handoffToolPath = path.join(toolDir, 'chatroom-handoff.ts');

    // Check if tools already exist
    if (checkExisting) {
      const existingFiles: string[] = [];
      const toolExists = yield* fsService.access(toolPath);
      if (toolExists) {
        existingFiles.push(toolPath);
      }
      const handoffExists = yield* fsService.access(handoffToolPath);
      if (handoffExists) {
        existingFiles.push(handoffToolPath);
      }

      if (existingFiles.length > 0) {
        return yield* Effect.fail<InstallToolError>({
          _tag: 'ToolsAlreadyExist',
          paths: existingFiles,
        });
      }
    }

    // Check if chatroom CLI is installed
    const installed = yield* fsService.isChatroomInstalled();
    if (!installed) {
      return yield* Effect.fail<InstallToolError>({ _tag: 'ChatroomNotInstalled' });
    }

    // Create directory if it doesn't exist
    yield* fsService
      .mkdir(toolDir, { recursive: true })
      .pipe(Effect.mapError((cause): InstallToolError => ({ _tag: 'FsError', cause })));

    // Write both tool files
    yield* fsService
      .writeFile(toolPath, TOOL_CONTENT, 'utf-8')
      .pipe(Effect.mapError((cause): InstallToolError => ({ _tag: 'FsError', cause })));
    yield* fsService
      .writeFile(handoffToolPath, HANDOFF_TOOL_CONTENT, 'utf-8')
      .pipe(Effect.mapError((cause): InstallToolError => ({ _tag: 'FsError', cause })));

    const message = `✅ Installed chatroom OpenCode tools successfully!

Locations:
  • ${toolPath}
  • ${handoffToolPath}

The following commands are now available in OpenCode:
  • chatroom (get-next-task) - Get next task from chatroom (no more timeouts!)
  • chatroom-handoff - Complete your task and hand off to the next role

Both tools will automatically check for:
  ✓ Chatroom CLI installation
  ✓ Authentication status

For local development, you can pass custom URLs to any tool:
  • webUrl - Override CHATROOM_WEB_URL (e.g., 'http://localhost:6249')
  • convexUrl - Override CHATROOM_CONVEX_URL (e.g., 'https://your-dev.convex.cloud')

If you're not authenticated, run:
  chatroom auth login`;

    yield* Effect.sync(() => {
      console.log(message);
    });

    return {
      success: true as const,
      toolPath,
      message,
    };
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console output + ToolInstallResult { success: false }.
 */
function handleInstallError(err: InstallToolError): Effect.Effect<ToolInstallResult, never> {
  return Effect.sync(() => {
    if (err._tag === 'ToolsAlreadyExist') {
      const message = `Tools already exist at:
${err.paths.map((f) => `  • ${f}`).join('\n')}

To reinstall, delete the existing files first:
${err.paths.map((f) => `  rm ${f}`).join('\n')}

Then run this command again, or use --force to overwrite.`;
      console.log(message);
      return { success: false as const, message };
    }
    if (err._tag === 'ChatroomNotInstalled') {
      const message = `⚠️  Chatroom CLI is not installed.

Please install the chatroom CLI globally first:
  npm install -g @chatroom/cli@latest

After installation, run this command again.`;
      console.log(message);
      return { success: false as const, message };
    }
    // FsError
    const message = `❌ Error installing OpenCode tool: ${err.cause}`;
    console.error(message);
    return { success: false as const, message };
  });
}

// ─── Entry Point (public API — unchanged signature) ────────────────────────

/**
 * Install chatroom as an OpenCode tool
 */
export async function installTool(
  options: ToolInstallOptions = {},
  deps?: OpenCodeInstallDeps
): Promise<ToolInstallResult> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  return Effect.runPromise(
    installToolEffect(options).pipe(
      Effect.catchAll((err) => handleInstallError(err)),
      Effect.provide(layer)
    )
  );
}
