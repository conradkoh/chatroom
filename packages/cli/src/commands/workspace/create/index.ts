/**
 * workspace create — register a new workspace for a chatroom on a machine.
 *
 * Creates a chatroom_workspaces row. The harness daemon uses this workspace
 * when opening harness sessions.
 */

import { api } from '../../../api.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceCreateOptions {
  chatroomId: string;
  machineId: string;
  /** Working directory on the machine. */
  cwd: string;
  /** Human-readable label for the workspace. */
  name: string;
}

export interface WorkspaceCreateDeps {
  readonly backend: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutation: (endpoint: any, args: any) => Promise<any>;
  };
  readonly sessionId: string;
  readonly stdout: (line: string) => void;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

async function createDefaultDeps(sessionIdValue: string): Promise<WorkspaceCreateDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
    },
    sessionId: sessionIdValue,
    stdout: (line) => process.stdout.write(line + '\n'),
  };
}

// ─── Command implementation ───────────────────────────────────────────────────

export async function workspaceCreate(
  options: WorkspaceCreateOptions,
  deps?: WorkspaceCreateDeps
): Promise<void> {
  const sessionIdValue = getSessionId();
  if (!sessionIdValue) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const d = deps ?? (await createDefaultDeps(sessionIdValue));

  await d.backend.mutation(api.workspaces.registerWorkspace, {
    sessionId: d.sessionId,
    chatroomId: options.chatroomId,
    machineId: options.machineId,
    workingDir: options.cwd,
    hostname: options.machineId, // use machineId as hostname for CLI-created workspaces
    registeredBy: 'cli',
  });

  d.stdout(`workspaceId: registered (workingDir: ${options.cwd})`);
  process.exit(0);
}
