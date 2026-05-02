/**
 * workspace list — list registered workspaces for a chatroom.
 */

import { api } from '../../../api.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceListOptions {
  chatroomId: string;
}

export interface WorkspaceListDeps {
  readonly backend: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (endpoint: any, args: any) => Promise<any>;
  };
  readonly sessionId: string;
  readonly stdout: (line: string) => void;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

async function createDefaultDeps(sessionIdValue: string): Promise<WorkspaceListDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      query: (endpoint, args) => client.query(endpoint, args),
    },
    sessionId: sessionIdValue,
    stdout: (line) => process.stdout.write(line + '\n'),
  };
}

// ─── Command implementation ───────────────────────────────────────────────────

export async function workspaceList(
  options: WorkspaceListOptions,
  deps?: WorkspaceListDeps
): Promise<void> {
  const sessionIdValue = getSessionId();
  if (!sessionIdValue) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const d = deps ?? (await createDefaultDeps(sessionIdValue));

  const workspaces = await d.backend.query(api.workspaces.listWorkspacesForChatroom, {
    sessionId: d.sessionId,
    chatroomId: options.chatroomId,
  });

  if (!workspaces || workspaces.length === 0) {
    d.stdout('No workspaces found for this chatroom.');
  } else {
    for (const ws of workspaces) {
      d.stdout(`${ws._id}  ${ws.workingDir}  (machine: ${ws.machineId})`);
    }
  }

  process.exit(0);
}
