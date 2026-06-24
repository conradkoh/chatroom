/**
 * OpenCodeSdkAgentService — concrete RemoteAgentService using the OpenCode SDK.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Uses @opencode-ai/sdk for session-based integration with OpenCode.
 * Spawns a local OpenCode server via child process, connects via SDK client,
 * and manages session lifecycle with the remote agent runtime.
 *
 * Extends BaseCLIAgentService which handles shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * isInstalled/getVersion helpers.
 */

import type { ChildProcess } from 'node:child_process';

import { createOpencodeClient } from '@opencode-ai/sdk';

import { buildAgentSpawnEnv } from '../../../convex/spawn-env.js';
import { type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { OpenCodeBinaryAgentService, OPENCODE_COMMAND } from '../opencode/binary-agent-service.js';
import { withTimeout } from '../with-timeout.js';
import { composeSystemPrompt } from './compose-system-prompt.js';
import type {
  SpawnContext,
  AgentStopOptions,
  DaemonHarnessSessionContext,
  HarnessReconnectMetadata,
  SpawnOptions,
  SpawnResult,
} from '../remote-agent-service.js';
import { forwardFiltered } from './node-streams.js';
import { waitForListeningUrl } from './parse-listening-url.js';
import { isInfoLine, parseModelId } from './pure.js';
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
import { StderrLineBuffer } from './stderr-line-buffer.js';
import { matchesTerminalProviderErrorText } from '../../../../domain/agent-lifecycle/policies/terminal-provider-error.js';

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps & {
  sessionMetadataStore?: SessionMetadataStore;
};

const SERVE_STARTUP_TIMEOUT_MS = 10000;
const SESSION_CREATE_TIMEOUT_MS = 30_000;
const PROMPT_ASYNC_TIMEOUT_MS = 60_000;
const SESSION_ABORT_TIMEOUT_MS = 5_000;
const SESSION_GET_TIMEOUT_MS = 10_000;
const AGENTS_LIST_TIMEOUT_MS = 10_000;

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

interface DisabledToolsPromptBody {
  agent: string;
  system?: string;
  parts: [{ type: 'text'; text: string }];
  model?: ReturnType<typeof parseModelId>;
  tools: {
    task: false;
    question: false;
    external_directory: false;
  };
}

function buildDisabledToolsPromptBody(args: {
  agentName: string;
  prompt: string;
  composedSystem?: string;
  model?: string;
}): DisabledToolsPromptBody {
  const modelParts = args.model ? parseModelId(args.model) : undefined;
  return {
    agent: args.agentName,
    ...(args.composedSystem ? { system: args.composedSystem } : {}),
    parts: [{ type: 'text', text: args.prompt }],
    ...(modelParts ? { model: modelParts } : {}),
    tools: {
      task: false,
      question: false,
      external_directory: false,
    },
  };
}

export class OpenCodeSdkAgentService extends OpenCodeBinaryAgentService {
  /** Per-pid agent_end callbacks — preserved across in-turn session fallback. */
  private readonly agentEndCallbacksByPid = new Map<number, (() => void)[]>();
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
    return super.listModels();
  }

  override async stop(pid: number, options?: AgentStopOptions): Promise<void> {
    const forwarder = this.forwarders.get(pid);
    if (forwarder) {
      forwarder.stop();
      this.forwarders.delete(pid);
    }

    const preserveForResume = options?.preserveForResume === true;
    const meta = this.sessionStore.findByPid(pid);
    if (meta) {
      if (!preserveForResume) {
        try {
          const client = createOpencodeClient({ baseUrl: meta.baseUrl });
          await withTimeout(
            client.session.abort({ path: { id: meta.sessionId } }),
            SESSION_ABORT_TIMEOUT_MS,
            'session.abort'
          );
        } catch (err) {
          console.warn(
            `[opencode-sdk] session.abort for pid=${pid} sessionId=${meta.sessionId} failed (continuing with SIGTERM):`,
            err instanceof Error ? err.message : err
          );
        }
        // Eager cleanup: doStop may kill before the child exit handler runs; stale
        // pid-keyed metadata would otherwise block resumeTurn.
        this.sessionStore.remove(meta.sessionId);
      }
    }
    await super.stop(pid);
  }

  private spawnServeProcess(workingDir: string, resolvedConvexUrl: string): ChildProcess {
    const childProcess = this.deps.spawn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: buildAgentSpawnEnv(resolvedConvexUrl),
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    return childProcess;
  }

  // fallow-ignore-next-line complexity
  private registerRunningSession(args: {
    childProcess: ChildProcess;
    pid: number;
    sessionId: string;
    context: SpawnContext;
    forwarder: SessionEventForwarderHandle | undefined;
    baseUrl: string;
    agentName: string;
    model: string | undefined;
    workingDir: string;
    logLineCallbacks: ((line: string) => void)[];
    deferredSystemPrompt?: string;
    outputCallbacks?: (() => void)[];
  }): SpawnResult {
    const {
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      agentName,
      model,
      logLineCallbacks,
      deferredSystemPrompt,
    } = args;

    const emitLogLine = (line: string) => {
      for (const lineCb of logLineCallbacks) lineCb(line);
    };

    const meta: SessionMetadata = {
      sessionId,
      machineId: context.machineId,
      chatroomId: context.chatroomId,
      role: context.role,
      agentName,
      ...(model ? { model } : {}),
      ...(deferredSystemPrompt ? { deferredSystemPrompt } : {}),
      pid,
      createdAt: new Date().toISOString(),
      baseUrl,
    };
    this.sessionStore.upsert(meta);

    const entry = this.registerProcess(pid, context);
    if (forwarder) this.forwarders.set(pid, forwarder);

    const outputCallbacks = args.outputCallbacks ?? [];

    forwardFiltered(childProcess.stdout ?? undefined, process.stdout, isInfoLine);
    forwardFiltered(childProcess.stderr ?? undefined, process.stderr, isInfoLine);

    if (childProcess.stdout) {
      childProcess.stdout.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      const stderrBuffer = new StderrLineBuffer((line) => {
        emitLogLine(line);
        const activeForwarder = this.forwarders.get(pid);
        if (activeForwarder && matchesTerminalProviderErrorText(line)) {
          activeForwarder.abortTerminalProviderError();
        }
      });
      childProcess.stderr.on('data', (chunk: Buffer | string) => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
        stderrBuffer.append(chunk.toString());
      });
      childProcess.on('exit', () => {
        stderrBuffer.flush();
      });
    }

    return {
      pid,
      harnessSessionId: sessionId,
      harnessReconnect: {
        agentName,
        ...(model ? { model } : {}),
      },
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          const fwd = this.forwarders.get(pid);
          if (fwd) {
            fwd.stop();
            this.forwarders.delete(pid);
          }
          this.sessionStore.remove(sessionId);
          this.agentEndCallbacksByPid.delete(pid);
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
      onLogLine: (cb) => {
        logLineCallbacks.push(cb);
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

  private async startServeAndClient(
    workingDir: string,
    resolvedConvexUrl: string
  ): Promise<{
    childProcess: ChildProcess;
    pid: number;
    baseUrl: string;
    client: OpencodeClient;
  }> {
    const childProcess = this.spawnServeProcess(workingDir, resolvedConvexUrl);
    const pid = childProcess.pid;
    if (pid == null) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    return { childProcess, pid, baseUrl, client: createOpencodeClient({ baseUrl }) };
  }

  private async listAvailableAgents(client: OpencodeClient) {
    const agentsResponse = await withTimeout(
      client.app.agents(),
      AGENTS_LIST_TIMEOUT_MS,
      'app.agents'
    );
    return agentsResponse.data ?? [];
  }

  private async promptSessionAsync(
    client: OpencodeClient,
    sessionId: string,
    body: DisabledToolsPromptBody
  ): Promise<void> {
    await withTimeout(
      client.session.promptAsync({
        path: { id: sessionId },
        body,
      }),
      PROMPT_ASYNC_TIMEOUT_MS,
      'session.promptAsync'
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
    sessionId?: string;
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
    context: SpawnContext;
    agentName: string;
    model?: string;
    prompt: string;
    oldSessionId?: string;
  }): Promise<void> {
    const existingForwarder = this.forwarders.get(args.pid);
    existingForwarder?.stop();
    this.forwarders.delete(args.pid);

    const client = createOpencodeClient({ baseUrl: args.baseUrl });

    const sessionCreateResult = await withTimeout(
      client.session.create({ body: {} }),
      SESSION_CREATE_TIMEOUT_MS,
      'session.create'
    );
    if (!sessionCreateResult.data?.id) {
      throw new Error('Failed to create session during resume fallback');
    }
    const newSessionId = sessionCreateResult.data.id;

    const forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
      sessionId: newSessionId,
      role: args.context.role,
    });

    const callbacks = this.agentEndCallbacksByPid.get(args.pid) ?? [];
    for (const cb of callbacks) {
      forwarder.onAgentEnd(cb);
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
    });

    await this.promptSessionAsync(
      client,
      newSessionId,
      buildDisabledToolsPromptBody({
        agentName: args.agentName,
        prompt: args.prompt,
        model: args.model,
      })
    );
  }

  async resumeFromDaemonMemory(
    options: SpawnOptions,
    session: DaemonHarnessSessionContext
  ): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;
    const sessionId = session.harnessSessionId;
    const agentName = session.agentName;
    const modelForSession = model ?? session.model;
    const workingDir = session.workingDir;

    const { childProcess, pid, baseUrl, client } = await this.startServeAndClient(
      workingDir,
      options.resolvedConvexUrl
    );

    let forwarder: SessionEventForwarderHandle | undefined;
    const { logLineCallbacks, emitLogLine } = this.createLogLineEmitter();
    const outputCallbacks: (() => void)[] = [];
    try {
      const sessionInfo = await withTimeout(
        client.session.get({ path: { id: sessionId } }),
        SESSION_GET_TIMEOUT_MS,
        'session.get'
      );
      if (!sessionInfo.data?.id) {
        throw new Error(
          `OpenCode session ${sessionId} not found (sessions may not survive serve restart)`
        );
      }

      forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
        sessionId,
        role: context.role,
        onLogLine: emitLogLine,
        onActivity: () => {
          for (const cb of outputCallbacks) cb();
        },
      });

      const availableAgents = await this.listAvailableAgents(client);
      const agentDef = availableAgents.find((a) => a.name === agentName);
      const composedSystem = composeSystemPrompt(agentDef?.prompt, systemPrompt);

      await this.promptSessionAsync(
        client,
        sessionId,
        buildDisabledToolsPromptBody({
          agentName,
          prompt,
          composedSystem,
          model: modelForSession,
        })
      );
    } catch (err) {
      this.writeRoleError(context.role, 'daemon-resume-fallback', err, '— cold spawning');
      forwarder?.stop();
      childProcess.kill();
      return this.spawn(options);
    }

    return this.registerRunningSession({
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      agentName,
      model: modelForSession,
      workingDir,
      logLineCallbacks,
      outputCallbacks,
    });
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;
    const deferInitialTurn = options.deferInitialTurn ?? false;

    const { childProcess, pid, baseUrl, client } = await this.startServeAndClient(
      options.workingDir,
      options.resolvedConvexUrl
    );

    let sessionId: string | undefined;
    let forwarder: SessionEventForwarderHandle | undefined;
    let agentName: string | undefined;
    let deferredSystemPrompt: string | undefined;
    const { logLineCallbacks, emitLogLine } = this.createLogLineEmitter();
    const outputCallbacks: (() => void)[] = [];
    try {
      const sessionCreateResult = await withTimeout(
        client.session.create({ body: {} }),
        SESSION_CREATE_TIMEOUT_MS,
        'session.create'
      );

      if (!sessionCreateResult.data?.id) {
        throw new Error('Failed to create session');
      }

      sessionId = sessionCreateResult.data.id;

      forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
        sessionId,
        role: context.role,
        onLogLine: emitLogLine,
        onActivity: () => {
          for (const cb of outputCallbacks) cb();
        },
      });

      // Discover what agents this opencode server actually exposes. We compose
      // against the runtime list rather than hard-coding names because (a) the
      // server caches its registry at startup, so client.config.update is a no-op
      // for runtime registration, and (b) the agent set is user-configurable.
      const availableAgents = await this.listAvailableAgents(client);
      const selected = selectAgent(availableAgents);
      agentName = selected.name;
      const composedSystem = composeSystemPrompt(selected.prompt, systemPrompt);
      if (deferInitialTurn) {
        deferredSystemPrompt = composedSystem;
      }

      if (!deferInitialTurn) {
        await this.promptSessionAsync(
          client,
          sessionId,
          buildDisabledToolsPromptBody({
            agentName: selected.name,
            prompt,
            composedSystem,
            model,
          })
        );
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
      agentName,
      model,
      workingDir: options.workingDir,
      logLineCallbacks,
      deferredSystemPrompt,
      outputCallbacks,
    });
  }

  getHarnessReconnectContext(pid: number): HarnessReconnectMetadata | undefined {
    const meta = this.sessionStore.findByPid(pid);
    if (!meta) {
      return undefined;
    }
    return {
      agentName: meta.agentName,
      ...(meta.model ? { model: meta.model } : {}),
    };
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const meta = this.sessionStore.findByPid(pid);
    if (!meta) {
      process.stderr.write(
        `[${new Date().toISOString()}] opencode-sdk resumeTurn: no metadata for pid=${pid}, skipping\n`
      );
      return;
    }

    const client = createOpencodeClient({ baseUrl: meta.baseUrl });
    const deferredSystem = meta.deferredSystemPrompt;
    const context: SpawnContext = {
      machineId: meta.machineId,
      chatroomId: meta.chatroomId,
      role: meta.role,
    };

    try {
      await this.promptSessionAsync(
        client,
        meta.sessionId,
        buildDisabledToolsPromptBody({
          agentName: meta.agentName,
          prompt,
          composedSystem: deferredSystem,
          model: meta.model,
        })
      );
      if (deferredSystem) {
        this.sessionStore.upsert({ ...meta, deferredSystemPrompt: undefined });
      }
    } catch (err) {
      this.writeRoleError(meta.role, 'resume-fallback', err, '— starting fresh session');
      await this.startFreshSessionOnServe({
        pid,
        baseUrl: meta.baseUrl,
        context,
        agentName: meta.agentName,
        model: meta.model,
        prompt,
        oldSessionId: meta.sessionId,
      });
    }
  }
}
