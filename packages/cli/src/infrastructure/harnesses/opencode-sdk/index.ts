/**
 * opencode-sdk DirectHarness adapter.
 *
 * Two distinct modes:
 *
 * 1. `createOpencodeSdkHarness()` — legacy/single-session mode.
 *    Each `openSession()` spawns a fresh `opencode serve` process. Used by tests
 *    and anywhere a registry is not available.
 *
 * 2. `spawnOpencodeSdkProcess()` + `createBoundOpencodeSdkHarness()` — multi-session mode.
 *    `spawnOpencodeSdkProcess` starts the server once and returns a process handle.
 *    `createBoundOpencodeSdkHarness` creates a spawner bound to the running process;
 *    its `openSession()` calls `client.session.create()` without spawning a new process.
 *    Used by `HarnessProcessRegistry` to support multiple sessions per workspace.
 *
 * `resumeSession()` is identical in both modes — reconnects via the session store.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';

import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  OpenSessionOptions,
  HarnessSessionId,
} from '../../../domain/direct-harness/index.js';

import type { HarnessProcess } from '../../../application/direct-harness/get-or-spawn-harness.js';
import { waitForListeningUrl } from '../../services/remote-agents/opencode-sdk/parse-listening-url.js';
import {
  FileSessionMetadataStore,
  type SessionMetadataStore,
} from '../../services/remote-agents/opencode-sdk/session-metadata-store.js';

import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
  type OpencodeSdkSessionClient,
} from './session.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for creating the opencode-sdk harness spawner (legacy single-session mode). */
export interface CreateOpencodeSdkHarnessOptions {
  /** Server startup timeout in ms. Default: 10 000 */
  readonly startupTimeoutMs?: number;
  /** Override the spawn function (for tests). */
  readonly spawnFn?: typeof nodeSpawn;
  /** Override Date.now (for tests). */
  readonly nowFn?: () => number;
  /**
   * Session persistence store.
   * Defaults to FileSessionMetadataStore so sessions survive daemon restarts.
   * Inject InMemorySessionMetadataStore in tests.
   */
  readonly sessionStore?: SessionMetadataStore;
}

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
}

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Create a DirectHarnessSession on an existing client (no process spawning). */
async function createSessionOnClient(
  client: OpencodeSdkSessionClient,
  sessionStore: SessionMetadataStore,
  meta: { machineId: string; chatroomId: string; role: string; pid: number; baseUrl: string },
  nowFn: () => number
): Promise<DirectHarnessSession> {
  let sdkSessionId: string;
  const result = await client.session.create({ body: {} });
  const sessionId = result.data?.id;
  if (!sessionId) throw new Error('Failed to create session: missing id');
  sdkSessionId = sessionId;

  const harnessSessionId = sdkSessionId as HarnessSessionId;

  sessionStore.upsert({
    sessionId: sdkSessionId,
    machineId: meta.machineId,
    chatroomId: meta.chatroomId,
    role: meta.role,
    pid: meta.pid,
    createdAt: new Date(nowFn()).toISOString(),
    baseUrl: meta.baseUrl,
  });

  let stopEventStream: () => void = () => {};

  // Bound sessions do NOT own the process — no killProcess callback
  const session = new OpencodeSdkDirectHarnessSession(
    harnessSessionId,
    client,
    () => stopEventStream(),
    undefined // process lifecycle managed by HarnessProcessRegistry
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
  childProcess.on('exit', () => { alive = false; });

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
        nowFn
      );
    },

    async resumeSession(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      const meta = store.get(harnessSessionId as string);
      if (!meta) {
        throw new Error(
          `Cannot resumeSession harnessSessionId=${harnessSessionId}: not found in session store.`
        );
      }

      // Reuse the running process's client if the session belongs to it
      const client: OpencodeSdkSessionClient =
        meta.baseUrl === processHandle.baseUrl
          ? processHandle.client
          : createOpencodeClient({ baseUrl: meta.baseUrl });

      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        undefined
      );

      stopEventStream = subscribeToSessionEvents(client, session, nowFn);
      return session;
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
  const spawner = createBoundOpencodeSdkHarness(
    processHandle,
    workspaceId,
    sessionStore,
    nowFn
  );

  return {
    workspaceId,
    spawner,
    isAlive: () => processHandle.isAlive(),
    async kill(): Promise<void> {
      await processHandle.kill();
    },
  };
}

// ─── Legacy single-session factory ───────────────────────────────────────────

/**
 * Creates a DirectHarnessSpawner for the opencode SDK harness.
 *
 * Legacy single-session mode: each `openSession()` spawns a fresh process.
 * Use `createOpencodeSdkHarnessProcess` + `HarnessProcessRegistry` for
 * multi-session (one process per workspace).
 */
export function createOpencodeSdkHarness(
  options: CreateOpencodeSdkHarnessOptions = {}
): DirectHarnessSpawner {
  const {
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    spawnFn = nodeSpawn,
    nowFn = Date.now,
    sessionStore = new FileSessionMetadataStore(),
  } = options;

  return {
    harnessName: 'opencode-sdk',

    async openSession(sessionOptions: OpenSessionOptions): Promise<DirectHarnessSession> {
      const config = (sessionOptions.config ?? {}) as OpencodeSdkSessionConfig;
      const chatroomId = config.chatroomId ?? '';
      const role = config.role ?? config.agent ?? 'unknown';
      const machineId = config.machineId ?? '';

      const cwd = sessionOptions.cwd ?? process.cwd();
      const env = {
        ...process.env,
        ...(sessionOptions.env ?? {}),
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      };

      // ── 1. Start the opencode serve process ──────────────────────────────
      const childProcess = spawnFn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: true,
      });

      if (!childProcess.pid) {
        throw new Error('Failed to spawn opencode serve process');
      }

      const pid = childProcess.pid;

      // ── 2. Wait for the server to start listening ─────────────────────────
      const baseUrl = await waitForListeningUrl(childProcess, {
        timeoutMs: startupTimeoutMs,
      }).catch((err: unknown) => {
        childProcess.kill();
        throw err;
      });

      // ── 3. Create the SDK client and a new bare session ───────────────────
      const sdkClient = createOpencodeClient({ baseUrl });

      let sdkSessionId: string;
      try {
        const result = await sdkClient.session.create({ body: {} });
        const sessionId = result.data?.id;
        if (!sessionId) throw new Error('Failed to create session: missing id');
        sdkSessionId = sessionId;
      } catch (err) {
        childProcess.kill();
        throw err;
      }

      const client: OpencodeSdkSessionClient = sdkClient;
      const harnessSessionId = sdkSessionId as HarnessSessionId;

      // ── 4. Persist session for resumeSession() across daemon restarts ─────
      sessionStore.upsert({
        sessionId: sdkSessionId,
        machineId,
        chatroomId,
        role,
        pid,
        createdAt: new Date(nowFn()).toISOString(),
        baseUrl,
      });

      // ── 5. Build the session ──────────────────────────────────────────────
      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        () => {
          sessionStore.remove(sdkSessionId);
          childProcess.kill();
        }
      );

      stopEventStream = subscribeToSessionEvents(client, session, nowFn);
      return session;
    },

    async resumeSession(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      const meta = sessionStore.get(harnessSessionId as string);
      if (!meta) {
        throw new Error(
          `Cannot resumeSession harnessSessionId=${harnessSessionId}: not found in session store. ` +
            `Ensure the harness was opened with this instance or the store file is accessible.`
        );
      }

      const client: OpencodeSdkSessionClient = createOpencodeClient({ baseUrl: meta.baseUrl });

      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        undefined
      );

      stopEventStream = subscribeToSessionEvents(client, session, nowFn);
      return session;
    },
  };
}
