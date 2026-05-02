/**
 * session open — open a new harness session in a registered workspace.
 */

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import { openSession } from '../../../application/direct-harness/open-session.js';
import type { OpenSessionDeps } from '../../../application/direct-harness/open-session.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';
import { openCodeChunkExtractor } from '../../../infrastructure/harnesses/opencode-sdk/chunk-extractor.js';
import { createOpencodeSdkHarnessProcess } from '../../../infrastructure/harnesses/opencode-sdk/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionOpenOptions {
  /** Convex Id of the workspace (from: `workspace list` or daemon registry). */
  workspaceId: string;
  /** Agent role opening this session (e.g. 'builder', 'planner'). */
  agent: string;
  /** Harness to use. Default: 'opencode-sdk'. */
  harness?: string;
}

export interface SessionOpenDeps extends OpenSessionDeps {
  readonly stdout: (line: string) => void;
  /** Optional override for the openSession implementation (for tests). */
  readonly openSessionImpl?: typeof openSession;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

const registry = new HarnessProcessRegistry(async (workspaceId, cwd) =>
  createOpencodeSdkHarnessProcess(workspaceId, cwd, { cwd })
);

async function createDefaultDeps(): Promise<SessionOpenDeps> {
  const client = await getConvexClient();
  const sessionIdValue = getSessionId();

  if (!sessionIdValue) {
    throw new Error('Not authenticated');
  }

  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    sessionId: sessionIdValue,
    harnessRegistry: registry,
    chunkExtractor: openCodeChunkExtractor,
    stdout: (line) => process.stdout.write(line + '\n'),
  };
}

// ─── Command implementation ───────────────────────────────────────────────────

/**
 * Open a new harness session in the specified workspace.
 * Prints harnessSessionRowId and harnessSessionId to stdout on success.
 */
export async function sessionOpen(
  options: SessionOpenOptions,
  deps?: SessionOpenDeps
): Promise<void> {
  const sessionIdValue = getSessionId();
  if (!sessionIdValue) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  let d: SessionOpenDeps;
  try {
    d = deps ?? (await createDefaultDeps());
  } catch {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const { workspaceId: workspaceIdRaw, agent, harness: _harness = 'opencode-sdk' } = options;
  const workspaceId = workspaceIdRaw as Id<'chatroom_workspaces'>;

  // Look up the workspace to get workingDir for harness process spawning
  const workspace = await d.backend.query(
    api.workspaces.getWorkspaceById,
    { sessionId: d.sessionId, workspaceId }
  ).catch(() => null);

  if (!workspace) {
    console.error(`❌ Workspace ${workspaceIdRaw} not found or not accessible.`);
    process.exit(1);
    return;
  }

  const openFn = d.openSessionImpl ?? openSession;

  const handle = await openFn(d, {
    workspaceId: workspaceIdRaw,
    workingDir: workspace.workingDir,
    harnessName: 'opencode-sdk',
    agent,
  });

  d.stdout(`harnessSessionRowId: ${handle.harnessSessionRowId}`);
  d.stdout(`harnessSessionId: ${handle.harnessSessionId}`);

  // The harness process runs detached — do NOT close the handle here.
  process.exit(0);
}
