import { api } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';
import { normalizeWorkingDirForLookup } from '../../infrastructure/services/workspace/normalize-working-dir.js';

export interface WorkspaceFileTreeDeps {
  backend: Pick<BackendOps, 'mutation' | 'query'>;
  session: { getSessionId: () => Promise<string | null> };
}

async function createDefaultDeps(): Promise<WorkspaceFileTreeDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId },
  };
}

async function requireSession(deps: WorkspaceFileTreeDeps): Promise<string> {
  const sessionId = await deps.session.getSessionId();
  if (!sessionId) throw new Error('Not authenticated. Please run: chatroom auth login');
  return sessionId;
}

export async function requestWorkspaceFileTreeFromCli(
  machineId: string,
  workingDir: string,
  options: { force?: boolean },
  deps?: WorkspaceFileTreeDeps
): Promise<{ status: string }> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);

  const result = await d.backend.mutation(api.workspaceFiles.requestFileTree, {
    sessionId,
    machineId,
    workingDir,
    ...(options.force ? { force: true } : {}),
  });

  return result as { status: string };
}

export async function getWorkspaceFileTreeStatusFromCli(
  machineId: string,
  workingDir: string,
  deps?: WorkspaceFileTreeDeps
): Promise<{
  checkpoint: unknown;
  manifest: unknown;
  pendingRequests: unknown;
}> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);

  const [checkpoint, manifest, pendingRequests] = await Promise.all([
    d.backend.query(api.workspaceFiles.getFileTreeCheckpoint, {
      sessionId,
      machineId,
      workingDir,
    }),
    d.backend.query(api.workspaceFiles.getFileTreeManifestV3, {
      sessionId,
      machineId,
      workingDir,
    }),
    d.backend.query(api.workspaceFiles.getPendingFileTreeRequests, {
      sessionId,
      machineId,
    }),
  ]);

  const normalized = normalizeWorkingDirForLookup(workingDir);
  const filtered = Array.isArray(pendingRequests)
    ? pendingRequests.filter(
        (r) =>
          r &&
          typeof r === 'object' &&
          'workingDir' in r &&
          normalizeWorkingDirForLookup(String((r as { workingDir: string }).workingDir)) ===
            normalized
      )
    : pendingRequests;
  return { checkpoint, manifest, pendingRequests: filtered };
}
