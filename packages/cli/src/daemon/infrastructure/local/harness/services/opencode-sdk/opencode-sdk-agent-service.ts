/**
 * OpenCodeSdkAgentService — concrete RemoteAgentService using the OpenCode V2 client.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Uses @opencode/client for session-based integration with OpenCode V2.
 * Spawns a local OpenCode server via child process, connects via the client,
 * and manages session lifecycle with the remote agent runtime.
 *
 * V2 notes:
 *   - Agent, model, and tool permissions are session-scoped and set at create
 *     time (or via switchAgent/switchModel) rather than on the prompt body.
 *   - The chatroom role system prompt is delivered as a session instruction
 *     entry, which OpenCode appends after the agent's own system prompt.
 *   - Tool restrictions are expressed as permission rules (`subagent`,
 *     `question`, `external_directory` → deny).
 *
 * Extends BaseCLIAgentService which handles shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * isInstalled/getVersion helpers.
 */

import type { ChildProcess } from 'node:child_process';

import { OpenCode } from '@opencode/client';
import type { AgentInfo, ModelRef, OpenCodeClient, PermissionRule } from '@opencode/client';

import { type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { requireHarnessModel } from '../require-harness-model.js';
import { withTimeout } from '../with-timeout.js';
import { ensureLocation } from './ensure-location.js';
import { fetchOpencodeProviderModelCatalog } from './opencode-model-catalog.js';
import { serverAuthHeaders, waitForListeningUrl } from './parse-listening-url.js';
import { isInfoLine, parseModelId, parseOpencodeSpawnModel } from './pure.js';
import { selectAgent } from './select-agent.js';
import {
  startSessionEventForwarder,
  type SessionEventForwarderClient,
  type SessionEventForwarderHandle,
} from './session-event-forwarder.js';
import {
  FileSessionMetadataStore,
  type SessionMetadata,
  type SessionMetadataStore,
} from './session-metadata-store.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivityEmitter,
} from '../../../../../services/service-interfaces.js';
import type { TurnCompletionResult } from '../turn-completion.js';
import { StderrLineBuffer } from './stderr-line-buffer.js';
import { buildAgentSpawnEnv } from '../../../../../../infrastructure/convex/spawn-env.js';
import { OpenCodeBinaryAgentService, OPENCODE_COMMAND } from '../opencode/binary-agent-service.js';
import type { SpawnContext, SpawnOptions, SpawnResult } from '../remote-agent-service.js';

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps & {
  sessionMetadataStore?: SessionMetadataStore | undefined;
};

const SERVE_STARTUP_TIMEOUT_MS = 10000;
const SESSION_CREATE_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 60_000;
const SESSION_ABORT_TIMEOUT_MS = 5_000;
const AGENTS_LIST_TIMEOUT_MS = 10_000;

/** Instruction-entry key for the chatroom role overlay. */
const CHATROOM_INSTRUCTION_KEY = 'chatroom-role';

/**
 * Session permissions that mirror the V1 disabled-tools behaviour.
 * OpenCode V2 expresses tool restrictions as ordered permission rules; the
 * action names differ from V1 (`task` → `subagent`, `question`/`external_directory` unchanged).
 */
const DISABLED_TOOL_PERMISSIONS: readonly PermissionRule[] = [
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'question', resource: '*', effect: 'deny' },
  { action: 'external_directory', resource: '*', effect: 'deny' },
];

/** Parse the chatroom `provider/model[variant]` string into a V2 ModelRef. */
function toModelRef(model: string): ModelRef | undefined {
  const parsed = parseOpencodeSpawnModel(model);
  const parts = parseModelId(parsed.model);
  if (!parts) return undefined;
  return {
    providerID: parts.providerID,
    id: parts.modelID,
    ...(parsed.variant ? { variant: parsed.variant } : {}),
  };
}

export class OpenCodeSdkAgentService extends OpenCodeBinaryAgentService {
  /** Per-pid agent_end callbacks — preserved across in-turn session fallback. */
  private readonly agentEndCallbacksByPid = new Map<number, (() => void)[]>();
  /** Per-pid typed turn-result callbacks — preserved across session fallback. */
  private readonly turnResultCallbacksByPid = new Map<
    number,
    ((result: TurnCompletionResult) => void)[]
  >();
  /** Per-pid assistant text callbacks — preserved across in-turn session fallback. */
  private readonly assistantTextCallbacksByPid = new Map<number, ((text: string) => void)[]>();
  /** Per-pid output callbacks — preserved for startFreshSessionOnServe fallback. */
  private readonly outputCallbacksByPid = new Map<number, (() => void)[]>();
  /** Per-pid typed activity emitters — shared across turns and forwarder replacement. */
  private readonly activityEmittersByPid = new Map<number, HarnessActivityEmitter>();
  readonly id = 'opencode-sdk';
  readonly displayName = 'OpenCode (SDK)';
  protected readonly listModelsHarnessId = 'opencode-sdk';
  private readonly sessionStore: SessionMetadataStore;
  private readonly forwarders = new Map<number, SessionEventForwarderHandle>();

  constructor(deps?: Partial<OpenCodeSdkAgentServiceDeps>) {
    super(deps);
    this.sessionStore = deps?.sessionMetadataStore ?? new FileSessionMetadataStore();
  }

  override async isInstalled(): Promise<boolean> {
    // SDK dependency is guaranteed at runtime; only the `opencode` binary gates availability.
    return super.isInstalled();
  }

  override async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return super.getVersion();
  }

  override async listModels(): Promise<string[]> {
    const fromProvider = await fetchOpencodeProviderModelCatalog(this.deps, process.cwd());
    if (fromProvider.length > 0) return fromProvider;
    return super.listModels();
  }

  override async stop(pid: number): Promise<void> {
    const forwarder = this.forwarders.get(pid);
    if (forwarder) {
      forwarder.stop();
      this.forwarders.delete(pid);
    }

    const meta = this.sessionStore.findByPid(pid);
    if (meta) {
      try {
        const client = this.makeClient(meta.baseUrl, meta.password);
        await withTimeout(
          client.session.interrupt({ sessionID: meta.sessionId }),
          SESSION_ABORT_TIMEOUT_MS,
          'session.interrupt'
        );
      } catch (err) {
        console.warn(
          `[opencode-sdk] session.interrupt for pid=${pid} sessionId=${meta.sessionId} failed (continuing with SIGTERM):`,
          err instanceof Error ? err.message : err
        );
      }
      // Eager cleanup: doStop may kill before the child exit handler runs.
      this.sessionStore.remove(meta.sessionId);
    }
    await super.stop(pid);
  }

  private spawnServeProcess(workingDir: string, resolvedConvexUrl: string): ChildProcess {
    const childProcess = this.deps.spawn(
      OPENCODE_COMMAND,
      ['serve', '--print-logs', '--log-level', 'warn'],
      {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: true,
        env: buildAgentSpawnEnv(resolvedConvexUrl),
      }
    );

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    return childProcess;
  }

  private buildSessionMetadata(args: {
    sessionId: string;
    context: SpawnContext;
    agentName: string;
    model: string | undefined;
    workingDir: string;
    deferredSystemPrompt?: string | undefined;
    pid: number;
    baseUrl: string;
    password?: string | undefined;
  }): SessionMetadata {
    const {
      sessionId,
      context,
      agentName,
      model,
      workingDir,
      deferredSystemPrompt,
      pid,
      baseUrl,
      password,
    } = args;
    return {
      sessionId,
      machineId: context.machineId,
      chatroomId: context.chatroomId,
      role: context.role,
      agentName,
      ...(model ? { model } : {}),
      workingDir,
      ...(deferredSystemPrompt ? { deferredSystemPrompt } : {}),
      pid,
      createdAt: new Date().toISOString(),
      baseUrl,
      ...(password ? { password } : {}),
    };
  }

  private wireChildOutput(
    childProcess: ChildProcess,
    pid: number,
    entry: { lastOutputAt: number },
    emitLogLine: (line: string) => void,
    outputCallbacks: (() => void)[],
    activityEmitter: HarnessActivityEmitter
  ): void {
    if (childProcess.stdout) {
      childProcess.stdout.on('data', () => {
        entry.lastOutputAt = Date.now();
        activityEmitter.emit({
          kind: 'transport',
          source: 'opencode.process.stdout',
          at: Date.now(),
        });
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      const stderrBuffer = new StderrLineBuffer((line) => {
        if (!isInfoLine(line)) emitLogLine(line);
      });
      childProcess.stderr.on('data', (chunk: Buffer | string) => {
        entry.lastOutputAt = Date.now();
        activityEmitter.emit({
          kind: 'transport',
          source: 'opencode.process.stderr',
          at: Date.now(),
        });
        for (const cb of outputCallbacks) cb();
        stderrBuffer.append(chunk.toString());
      });
      childProcess.on('exit', () => {
        stderrBuffer.flush();
      });
    }
  }

  private createSessionForwarder(
    client: SessionEventForwarderClient,
    sessionId: string,
    context: SpawnContext,
    emitLogLine: (line: string) => void,
    emitAssistantText: ((text: string) => void) | undefined,
    outputCallbacks: (() => void)[],
    activityEmitter: HarnessActivityEmitter
  ): SessionEventForwarderHandle {
    return startSessionEventForwarder(client, {
      sessionId,
      role: context.role,
      onLogLine: emitLogLine,
      onAssistantText: emitAssistantText,
      onActivity: (event) => {
        activityEmitter.emit(event);
        if (event.kind === 'progress') {
          for (const cb of outputCallbacks) cb();
        }
      },
    });
  }

  private registerRunningSession(args: {
    childProcess: ChildProcess;
    pid: number;
    sessionId: string;
    context: SpawnContext;
    forwarder: SessionEventForwarderHandle | undefined;
    baseUrl: string;
    password: string | undefined;
    agentName: string;
    model: string | undefined;
    workingDir: string;
    logLineCallbacks: ((line: string) => void)[];
    assistantTextCallbacks?: ((text: string) => void)[] | undefined;
    turnResultCallbacks?: ((result: TurnCompletionResult) => void)[] | undefined;
    deferredSystemPrompt?: string | undefined;
    outputCallbacks?: (() => void)[] | undefined;
    activityEmitter: HarnessActivityEmitter;
  }): SpawnResult {
    const {
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      password,
      agentName,
      model,
      workingDir,
      logLineCallbacks,
      deferredSystemPrompt,
    } = args;

    const emitLogLine = (line: string) => {
      for (const lineCb of logLineCallbacks) lineCb(line);
    };

    this.sessionStore.upsert(
      this.buildSessionMetadata({
        sessionId,
        context,
        agentName,
        model,
        workingDir,
        deferredSystemPrompt,
        pid,
        baseUrl,
        password,
      })
    );

    const entry = this.registerProcess(pid, context);
    if (forwarder) this.forwarders.set(pid, forwarder);
    if (args.assistantTextCallbacks) {
      this.assistantTextCallbacksByPid.set(pid, args.assistantTextCallbacks);
    }
    if (args.turnResultCallbacks) {
      this.turnResultCallbacksByPid.set(pid, args.turnResultCallbacks);
    }
    if (args.outputCallbacks) {
      this.outputCallbacksByPid.set(pid, args.outputCallbacks);
    }
    this.activityEmittersByPid.set(pid, args.activityEmitter);

    const outputCallbacks = args.outputCallbacks ?? [];
    this.wireChildOutput(
      childProcess,
      pid,
      entry,
      emitLogLine,
      outputCallbacks,
      args.activityEmitter
    );

    return {
      pid,
      harnessSessionId: sessionId,
      activityEmitter: args.activityEmitter,
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          const fwd = this.forwarders.get(pid);
          if (fwd) {
            fwd.stop();
            this.forwarders.delete(pid);
          }
          this.sessionStore.remove(sessionId);
          this.agentEndCallbacksByPid.delete(pid);
          this.turnResultCallbacksByPid.delete(pid);
          this.assistantTextCallbacksByPid.delete(pid);
          this.outputCallbacksByPid.delete(pid);
          this.activityEmittersByPid.delete(pid);
          this.deleteProcess(pid);
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onAgentEnd: (cb) => {
        const callbacks = this.agentEndCallbacksByPid.get(pid) ?? [];
        callbacks.push(cb);
        this.agentEndCallbacksByPid.set(pid, callbacks);
        forwarder?.onAgentEnd(cb);
      },
      onTurnResult: (cb) => {
        const callbacks = this.turnResultCallbacksByPid.get(pid) ?? [];
        callbacks.push(cb);
        this.turnResultCallbacksByPid.set(pid, callbacks);
        forwarder?.onTurnResult(cb);
      },
      onLogLine: (cb) => {
        logLineCallbacks.push(cb);
      },
      onAssistantText: (cb) => {
        const callbacks =
          this.assistantTextCallbacksByPid.get(pid) ?? args.assistantTextCallbacks ?? [];
        callbacks.push(cb);
        this.assistantTextCallbacksByPid.set(pid, callbacks);
      },
    };
  }

  private createLogLineEmitter(): {
    logLineCallbacks: ((line: string) => void)[];
    emitLogLine: (line: string) => void;
  } {
    const logLineCallbacks: ((line: string) => void)[] = [];
    return {
      logLineCallbacks,
      emitLogLine: (line: string) => {
        for (const cb of logLineCallbacks) cb(line);
      },
    };
  }

  private createAssistantTextEmitter(): {
    assistantTextCallbacks: ((text: string) => void)[];
    emitAssistantText: (text: string) => void;
  } {
    const assistantTextCallbacks: ((text: string) => void)[] = [];
    return {
      assistantTextCallbacks,
      emitAssistantText: (text: string) => {
        for (const cb of assistantTextCallbacks) cb(text);
      },
    };
  }

  private makeClient(baseUrl: string, password?: string | undefined): OpenCodeClient {
    const headers = serverAuthHeaders(password);
    return OpenCode.make({ baseUrl, ...(headers ? { headers } : {}) });
  }

  private async startServeAndClient(
    workingDir: string,
    resolvedConvexUrl: string
  ): Promise<{
    childProcess: ChildProcess;
    pid: number;
    baseUrl: string;
    password: string | undefined;
    client: OpenCodeClient;
  }> {
    const childProcess = this.spawnServeProcess(workingDir, resolvedConvexUrl);
    const pid = childProcess.pid;
    if (pid == null) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const { url, password } = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    return { childProcess, pid, baseUrl: url, password, client: this.makeClient(url, password) };
  }

  private async listAvailableAgents(
    client: OpenCodeClient,
    workingDir: string
  ): Promise<AgentInfo[]> {
    await ensureLocation(client, workingDir);
    const agentsResponse = await withTimeout(
      client.agent.list({ location: { directory: workingDir } }),
      AGENTS_LIST_TIMEOUT_MS,
      'agent.list'
    );
    return agentsResponse.data ?? [];
  }

  /** Submit a prompt and return once the server has accepted it. */
  private async promptSession(
    client: OpenCodeClient,
    sessionId: string,
    text: string
  ): Promise<void> {
    await withTimeout(
      client.session.prompt({ sessionID: sessionId, text }),
      PROMPT_TIMEOUT_MS,
      'session.prompt'
    );
  }

  /** Set (or replace) the chatroom role instruction entry on a session. */
  private async setSystemInstruction(
    client: OpenCodeClient,
    sessionId: string,
    system: string
  ): Promise<void> {
    await withTimeout(
      client.session.instructions.entry.put({
        sessionID: sessionId,
        key: CHATROOM_INSTRUCTION_KEY,
        value: system,
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'session.instructions.entry.put'
    );
  }

  private writeRoleError(role: string, label: string, err: unknown, suffix?: string): void {
    const reason = err instanceof Error ? err.message : String(err);
    const tail = suffix ? ` ${suffix}` : '';
    process.stderr.write(`[${new Date().toISOString()}] role:${role} ${label}] ${reason}${tail}\n`);
  }

  private tearDownFailedSpawn(args: {
    forwarder: SessionEventForwarderHandle | undefined;
    childProcess: ChildProcess;
    sessionId?: string | undefined;
  }): void {
    args.forwarder?.stop();
    args.childProcess.kill();
    if (args.sessionId) this.sessionStore.remove(args.sessionId);
  }

  /**
   * Best-effort in-turn recovery: create a new OpenCode session on an existing
   * serve process when resume on the prior sessionId fails.
   */
  private async startFreshSessionOnServe(args: {
    pid: number;
    baseUrl: string;
    password?: string | undefined;
    context: SpawnContext;
    agentName: string;
    model: string;
    /** Spawn working directory; passed as `location` so the fresh session matches the primary path. */
    workingDir: string | undefined;
    prompt: string;
    oldSessionId?: string | undefined;
  }): Promise<void> {
    const model = requireHarnessModel(args.model, 'opencode-sdk resume fallback');
    const existingForwarder = this.forwarders.get(args.pid);
    existingForwarder?.stop();
    this.forwarders.delete(args.pid);

    const client = this.makeClient(args.baseUrl, args.password);

    const fallbackModel = toModelRef(model);
    const sessionCreateResult = await withTimeout(
      client.session.create({
        agent: args.agentName,
        ...(fallbackModel ? { model: fallbackModel } : {}),
        permissions: DISABLED_TOOL_PERMISSIONS,
        // Constraint: must match the primary spawn() path. Without `location`, OpenCode
        // resolves the session against the server's default directory, not the workspace.
        // Legacy metadata written before workingDir was persisted has no value here.
        ...(args.workingDir ? { location: { directory: args.workingDir } } : {}),
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'session.create'
    );
    if (!sessionCreateResult.id) {
      throw new Error('Failed to create session during resume fallback');
    }
    const newSessionId = sessionCreateResult.id;

    const { emitLogLine } = this.createLogLineEmitter();
    const pidOutputCallbacks = this.outputCallbacksByPid.get(args.pid) ?? [];
    const activityEmitter = this.activityEmittersByPid.get(args.pid);
    if (!activityEmitter) {
      throw new Error(`No activity emitter for pid=${args.pid}`);
    }

    const forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
      sessionId: newSessionId,
      role: args.context.role,
      onLogLine: emitLogLine,
      onAssistantText: (text) => {
        const callbacks = this.assistantTextCallbacksByPid.get(args.pid) ?? [];
        for (const cb of callbacks) cb(text);
      },
      onActivity: (event) => {
        activityEmitter.emit(event);
        if (event.kind === 'progress') {
          for (const cb of pidOutputCallbacks) cb();
        }
      },
    });

    const callbacks = this.agentEndCallbacksByPid.get(args.pid) ?? [];
    for (const cb of callbacks) {
      forwarder.onAgentEnd(cb);
    }
    const turnResultCallbacks = this.turnResultCallbacksByPid.get(args.pid) ?? [];
    for (const cb of turnResultCallbacks) {
      forwarder.onTurnResult(cb);
    }
    this.forwarders.set(args.pid, forwarder);

    if (args.oldSessionId) {
      this.sessionStore.remove(args.oldSessionId);
    }
    this.sessionStore.upsert({
      sessionId: newSessionId,
      machineId: args.context.machineId,
      chatroomId: args.context.chatroomId,
      role: args.context.role,
      agentName: args.agentName,
      ...(args.model ? { model: args.model } : {}),
      pid: args.pid,
      createdAt: new Date().toISOString(),
      baseUrl: args.baseUrl,
      ...(args.password ? { password: args.password } : {}),
    });

    activityEmitter.beginTurn();
    await this.promptSession(client, newSessionId, args.prompt);
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, systemPrompt, context } = options;
    const model = requireHarnessModel(options.model, 'opencode-sdk spawn');
    const deferInitialTurn = options.deferInitialTurn ?? false;
    // Whitespace-only overlays are treated as absent (mirrors the V1 composer).
    const roleSystem = systemPrompt.trim().length > 0 ? systemPrompt : undefined;

    const { childProcess, pid, baseUrl, password, client } = await this.startServeAndClient(
      options.workingDir,
      options.resolvedConvexUrl
    );

    let sessionId: string | undefined;
    let forwarder: SessionEventForwarderHandle | undefined;
    let agentName: string | undefined;
    let deferredSystemPrompt: string | undefined;
    const activityEmitter = createHarnessActivityEmitter();
    const { logLineCallbacks, emitLogLine } = this.createLogLineEmitter();
    const { assistantTextCallbacks, emitAssistantText } = this.createAssistantTextEmitter();
    const outputCallbacks: (() => void)[] = [];
    try {
      // Discover what agents this opencode server actually exposes. We select
      // against the runtime list rather than hard-coding names because the agent
      // set is user-configurable and the server caches its registry at startup.
      const availableAgents = await this.listAvailableAgents(client, options.workingDir);
      const selected = selectAgent(availableAgents);
      agentName = selected.id;

      // V2 session-scoped selection: agent, model, and tool permissions.
      const modelRef = toModelRef(model);
      const sessionCreateResult = await withTimeout(
        client.session.create({
          agent: selected.id,
          ...(modelRef ? { model: modelRef } : {}),
          permissions: DISABLED_TOOL_PERMISSIONS,
          location: { directory: options.workingDir },
        }),
        SESSION_CREATE_TIMEOUT_MS,
        'session.create'
      );

      if (!sessionCreateResult.id) {
        throw new Error('Failed to create session');
      }

      sessionId = sessionCreateResult.id;

      forwarder = this.createSessionForwarder(
        client as SessionEventForwarderClient,
        sessionId,
        context,
        emitLogLine,
        emitAssistantText,
        outputCallbacks,
        activityEmitter
      );

      if (deferInitialTurn) {
        deferredSystemPrompt = roleSystem;
      } else {
        activityEmitter.beginTurn();
        if (roleSystem) {
          await this.setSystemInstruction(client, sessionId, roleSystem);
        }
        await this.promptSession(client, sessionId, prompt);
      }
    } catch (err) {
      // Surface a human-readable, role-prefixed reason to the daemon log before
      // tearing down. The daemon already pipes our stderr through; we match the
      // formatting style used by SessionEventForwarder so operators see one
      // consistent log shape regardless of failure source.
      this.writeRoleError(context.role, 'spawn-error', err);
      this.tearDownFailedSpawn({ forwarder, childProcess, sessionId });
      throw err;
    }

    if (!sessionId || !agentName) {
      throw new Error('OpenCode session was not initialized');
    }

    return this.registerRunningSession({
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      password,
      agentName,
      model,
      workingDir: options.workingDir,
      logLineCallbacks,
      assistantTextCallbacks,
      turnResultCallbacks: [],
      deferredSystemPrompt,
      outputCallbacks,
      activityEmitter,
    });
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const meta = this.sessionStore.findByPid(pid);
    if (!meta) {
      process.stderr.write(
        `[${new Date().toISOString()}] opencode-sdk resumeTurn: no metadata for pid=${pid}, skipping\n`
      );
      return;
    }

    this.forwarders.get(pid)?.armTurnEnd();

    const activityEmitter = this.activityEmittersByPid.get(pid);
    activityEmitter?.beginTurn();

    const client = this.makeClient(meta.baseUrl, meta.password);
    const model = requireHarnessModel(meta.model, 'opencode-sdk resumeTurn');
    const deferredSystem = meta.deferredSystemPrompt;
    const context: SpawnContext = {
      machineId: meta.machineId,
      chatroomId: meta.chatroomId,
      role: meta.role,
    };

    try {
      if (deferredSystem) {
        await this.setSystemInstruction(client, meta.sessionId, deferredSystem);
      }
      await this.promptSession(client, meta.sessionId, prompt);
      if (deferredSystem) {
        this.sessionStore.upsert({ ...meta, deferredSystemPrompt: undefined });
      }
    } catch (err) {
      this.writeRoleError(meta.role, 'resume-fallback', err, '— starting fresh session');
      await this.startFreshSessionOnServe({
        pid,
        baseUrl: meta.baseUrl,
        password: meta.password,
        context,
        agentName: meta.agentName,
        model,
        workingDir: meta.workingDir,
        prompt,
        oldSessionId: meta.sessionId,
      });
    }
  }
}
