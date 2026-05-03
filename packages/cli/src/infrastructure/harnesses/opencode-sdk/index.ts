/**
 * opencode-sdk DirectHarness adapter.
 *
 * Multi-session bound spawner (`createOpencodeSdkHarnessProcess`) for the daemon,
 * plus `createOpencodeSdkResumer` for the CLI `session resume` command (resume-only).
 *
 * `resumeSession` logic is shared via `resumeSessionFromStore()`.
 */

import { spawn as nodeSpawn } from 'node:child_process';

import { createOpencodeClient } from '@opencode-ai/sdk';

import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
  type OpencodeSdkSessionClient,
} from './session.js';
import type { HarnessProcess } from '../../../application/direct-harness/get-or-spawn-harness.js';
import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  OpenSessionOptions,
  HarnessSessionId,
 PublishedAgent, PublishedProvider } from '../../../domain/direct-harness/index.js';
import { waitForListeningUrl } from '../../services/remote-agents/opencode-sdk/parse-listening-url.js';
import {
  FileSessionMetadataStore,
  type SessionMetadataStore,
} from '../../services/remote-agents/opencode-sdk/session-metadata-store.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for spawning an opencode serve process (multi-session mode). */
export interface SpawnOpencodeSdkProcessOptions {
  /** Working directory for the opencode serve process. */
  readonly cwd: string;
  /** Additional environment variables. */
  readonly env?: Readonly<Record<string, string>>;
  /** Server startup timeout in ms. Default: 10 000 */
  readonly startupTimeoutMs?: number;
  /** Override the spawn function (for tests). */
  readonly spawnFn?: typeof nodeSpawn;
  /** Override Date.now (for tests). */
  readonly nowFn?: () => number;
}

/** A live opencode-sdk process handle. */
export interface OpencodeSdkProcessHandle {
  /** The base URL of the running opencode server. */
  readonly baseUrl: string;
  /** The OS PID of the opencode serve process. */
  readonly pid: number;
  /** The SDK client connected to this process. */
  readonly client: OpencodeSdkSessionClient;
  /** Whether the process is still running. */
  isAlive(): boolean;
  /** Kill the process. Idempotent. */
  kill(): Promise<void>;
}

/** Fields available in OpenSessionOptions.config. */
interface OpencodeSdkSessionConfig {
  agent?: string;
  chatroomId?: string;
  role?: string;
  machineId?: string;
  /** Display title for the opencode session (synced to sidebar). */
  title?: string;
}

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Create a DirectHarnessSession on an existing client (no process spawning). */
async function createSessionOnClient(
  client: OpencodeSdkSessionClient,
  sessionStore: SessionMetadataStore,
  meta: { machineId: string; chatroomId: string; role: string; pid: number; baseUrl: string },
  nowFn: () => number,
  title?: string
): Promise<DirectHarnessSession> {
  let sdkSessionId: string;
  const result = await client.session.create({
    body: { ...(title ? { title } : {}) },
  });
  const sessionId = result.data?.id;
  if (!sessionId) throw new Error('Failed to create session: missing id');
  sdkSessionId = sessionId;

  // Capture the title from the response (opencode may auto-generate or use ours)
  const sessionTitle = result.data?.title ?? title ?? meta.role;

  const harnessSessionId = sdkSessionId as HarnessSessionId;

  sessionStore.upsert({
    sessionId: sdkSessionId,
    machineId: meta.machineId,
    chatroomId: meta.chatroomId,
    role: meta.role,
    title: sessionTitle,
    pid: meta.pid,
    createdAt: new Date(nowFn()).toISOString(),
    baseUrl: meta.baseUrl,
  });

  let stopEventStream: () => void = () => {};

  // Bound sessions do NOT own the process — no killProcess callback
  const session = new OpencodeSdkDirectHarnessSession(
    harnessSessionId,
    sessionTitle,
    client,
    () => stopEventStream(),
    undefined // process lifecycle managed by HarnessProcessRegistry
  );

  stopEventStream = subscribeToSessionEvents(client, session, nowFn);
  return session;
}

// ─── Shared resume logic ────────────────────────────────────────────────────

/** Options for resumeSessionFromStore that control client reuse. */
interface ResumeClientOptions {
  /** If provided, reuse this client when the stored baseUrl matches. */
  readonly reuseClient?: {
    readonly baseUrl: string;
    readonly client: OpencodeSdkSessionClient;
  };
}

/**
 * Resume a session from the session metadata store.
 *
 * Shared between the bound spawner (reuses the process client when possible)
 * and the CLI resume command (always creates a fresh client).
 *
 * Throws a clear error if the session ID is not found in the store.
 */
export async function resumeSessionFromStore(
  harnessSessionId: HarnessSessionId,
  sessionStore: SessionMetadataStore,
  opts: ResumeClientOptions = {},
  nowFn: () => number = Date.now
): Promise<DirectHarnessSession> {
  const meta = sessionStore.get(harnessSessionId as string);
  if (!meta) {
    throw new Error(
      `Cannot resumeSession harnessSessionId=${harnessSessionId}: not found in session store.`
    );
  }

  // Reuse the running process's client if the session belongs to it
  const client: OpencodeSdkSessionClient =
    opts.reuseClient && meta.baseUrl === opts.reuseClient.baseUrl
      ? opts.reuseClient.client
      : createOpencodeClient({ baseUrl: meta.baseUrl });

  let stopEventStream: () => void = () => {};

  const session = new OpencodeSdkDirectHarnessSession(
    harnessSessionId,
    meta.title ?? meta.role, // Use stored title if available, fall back to role
    client,
    () => stopEventStream(),
    undefined // process lifecycle managed elsewhere
  );

  stopEventStream = subscribeToSessionEvents(client, session, nowFn);
  return session;
}

// ─── Multi-session: process spawning + bound harness ─────────────────────────

/**
 * Spawn a new `opencode serve` process in the given working directory.
 * Returns a handle with the running client, pid, and lifecycle methods.
 *
 * Used by `HarnessProcessRegistry` to prepare a process for multi-session use.
 */
export async function spawnOpencodeSdkProcess(
  workspaceId: string,
  cwd: string,
  options: SpawnOpencodeSdkProcessOptions = { cwd }
): Promise<OpencodeSdkProcessHandle> {
  const {
    env: extraEnv,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    spawnFn = nodeSpawn,
    nowFn: _nowFn = Date.now,
  } = options;

  const env = {
    ...process.env,
    ...(extraEnv ?? {}),
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
  };

  const childProcess = spawnFn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    detached: true,
  });

  if (!childProcess.pid) {
    throw new Error(`Failed to spawn opencode serve process for workspace ${workspaceId}`);
  }

  const pid = childProcess.pid;

  const baseUrl = await waitForListeningUrl(childProcess, {
    timeoutMs: startupTimeoutMs,
  }).catch((err: unknown) => {
    childProcess.kill();
    throw err;
  });

  const sdkClient = createOpencodeClient({ baseUrl });
  const client: OpencodeSdkSessionClient = sdkClient;

  let alive = true;
  childProcess.on('exit', () => {
    alive = false;
  });

  return {
    baseUrl,
    pid,
    client,
    isAlive: () => alive,
    async kill(): Promise<void> {
      if (!alive) return;
      alive = false;
      childProcess.kill();
    },
  };
}

/**
 * Create a `DirectHarnessSpawner` bound to an already-running opencode-sdk process.
 *
 * `openSession()` calls `client.session.create()` on the existing client
 * without spawning a new process.
 * `resumeSession()` reconnects via the session store (same as the standalone variant).
 *
 * This is the spawner returned inside `HarnessProcess.spawner` by the registry.
 */
export function createBoundOpencodeSdkHarness(
  processHandle: OpencodeSdkProcessHandle,
  workspaceId: string,
  sessionStore?: SessionMetadataStore,
  nowFn: () => number = Date.now
): DirectHarnessSpawner {
  const store = sessionStore ?? new FileSessionMetadataStore();

  return {
    harnessName: 'opencode-sdk',

    async openSession(sessionOptions: OpenSessionOptions): Promise<DirectHarnessSession> {
      const config = (sessionOptions.config ?? {}) as OpencodeSdkSessionConfig;
      const agent = config.agent ?? config.role ?? 'unknown';
      const title = config.title ?? agent;

      return createSessionOnClient(
        processHandle.client,
        store,
        {
          machineId: config.machineId ?? workspaceId,
          chatroomId: config.chatroomId ?? workspaceId,
          role: agent,
          pid: processHandle.pid,
          baseUrl: processHandle.baseUrl,
        },
        nowFn,
        title
      );
    },

    async resumeSession(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      return resumeSessionFromStore(
        harnessSessionId,
        store,
        { reuseClient: { baseUrl: processHandle.baseUrl, client: processHandle.client } },
        nowFn
      );
    },
  };
}

/**
 * Creates a `HarnessProcess` for use in `HarnessProcessRegistry`.
 * Spawns the opencode serve process and wraps it with a bound spawner.
 */
export async function createOpencodeSdkHarnessProcess(
  workspaceId: string,
  cwd: string,
  options: SpawnOpencodeSdkProcessOptions = { cwd },
  sessionStore?: SessionMetadataStore,
  nowFn: () => number = Date.now
): Promise<HarnessProcess> {
  const processHandle = await spawnOpencodeSdkProcess(workspaceId, cwd, options);
  const spawner = createBoundOpencodeSdkHarness(processHandle, workspaceId, sessionStore, nowFn);

  return {
    workspaceId,
    spawner,
    isAlive: () => processHandle.isAlive(),
    async kill(): Promise<void> {
      await processHandle.kill();
    },
    async listAgents(): Promise<readonly PublishedAgent[]> {
      try {
        const response = await processHandle.client.app.agents();
        const sdkAgents = response.data ?? [];
        return sdkAgents.map(
          (a): PublishedAgent => ({
            name: a.name,
            mode: a.mode,
            ...(a.model ? { model: a.model } : {}),
            ...(a.description ? { description: a.description } : {}),
          })
        );
      } catch (err) {
        console.warn(
          `[direct-harness] listAgents failed for workspace ${workspaceId}: ${
            err instanceof Error ? err.message : String(err)
          }. Returning empty agent list.`
        );
        return [];
      }
    },
    async listProviders(): Promise<readonly PublishedProvider[]> {
      try {
        const response = await processHandle.client.config.providers();
        const sdkProviders = response.data?.providers ?? [];
        return sdkProviders.map(
          (p): PublishedProvider => ({
            providerID: p.id,
            name: p.name,
            models: Object.entries(p.models).map(([modelID, m]) => ({
              modelID,
              name: m.name,
            })),
          })
        );
      } catch (err) {
        console.warn(
          `[direct-harness] listProviders failed for workspace ${workspaceId}: ${
            err instanceof Error ? err.message : String(err)
          }. Returning empty provider list.`
        );
        return [];
      }
    },
  };
}

// ─── CLI resume-only spawner ─────────────────────────────────────────────────

/** Options for `createOpencodeSdkResumer`. */
export interface CreateOpencodeSdkResumerOptions {
  /** Override Date.now (for tests). */
  readonly nowFn?: () => number;
  /**
   * Session persistence store.
   * Defaults to FileSessionMetadataStore so sessions survive daemon restarts.
   * Inject InMemorySessionMetadataStore in tests.
   */
  readonly sessionStore?: SessionMetadataStore;
}

/**
 * Creates a resume-only DirectHarnessSpawner for the CLI `session resume` command.
 *
 * `openSession()` throws — new sessions must be opened via the daemon's
 * `HarnessProcessRegistry` using `createOpencodeSdkHarnessProcess`.
 * `resumeSession()` reconnects to an existing session via the session store.
 */
export function createOpencodeSdkResumer(
  options: CreateOpencodeSdkResumerOptions = {}
): DirectHarnessSpawner {
  const { nowFn = Date.now, sessionStore = new FileSessionMetadataStore() } = options;

  return {
    harnessName: 'opencode-sdk',

    async openSession(): Promise<DirectHarnessSession> {
      throw new Error(
        'createOpencodeSdkResumer cannot open new sessions; use createOpencodeSdkHarnessProcess via HarnessProcessRegistry instead'
      );
    },

    async resumeSession(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      return resumeSessionFromStore(harnessSessionId, sessionStore, {}, nowFn);
    },
  };
}
