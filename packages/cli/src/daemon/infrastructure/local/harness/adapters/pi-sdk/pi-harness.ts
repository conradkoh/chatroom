/**
 * PiSdkHarness — BoundHarness implementation using @earendil-works/pi-coding-agent in-process.
 */

import type { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

import { PiSdkSession } from './pi-session.js';
import type {
  BoundHarness,
  BoundHarnessFactory,
  ModelInfo,
  NewSessionConfig,
  ResumeHarnessSessionOptions,
} from '../../../../../domain/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../../../domain/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';
import type {
  PublishedAgent,
  PublishedProvider,
} from '../../../../../domain/entities/machine-capabilities.js';
import { getPiSessionDir } from '../../services/pi/pi-agent-service.js';
import { parsePiSpawnModel, resolvePiThinkingLevel } from '../../services/pi/pure.js';
import { formatPiSdkLoadError, importBundledPiSdk } from '../../services/pi-sdk/pi-sdk-package.js';
import { requireHarnessModel } from '../../services/require-harness-model.js';
import { withTimeout } from '../../services/with-timeout.js';

const SESSION_CREATE_TIMEOUT_MS = 60_000;

type LoadedPiSdk = Awaited<ReturnType<typeof importBundledPiSdk>>;

let _sdkCache: LoadedPiSdk | undefined;
let _sdkLoadError: unknown;

async function loadSdk(): Promise<LoadedPiSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledPiSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

type PiSessionManager = ReturnType<LoadedPiSdk['SessionManager']['create']>;

/** Resolves `provider/id` via getModel, or a bare `id` by searching the chat models. */
function resolveRequiredModel(modelRuntime: ModelRuntime, model: string) {
  const slash = model.indexOf('/');
  const resolved =
    slash === -1
      ? modelRuntime.getModels().find((entry) => entry.id === model)
      : modelRuntime.getModel(model.slice(0, slash), model.slice(slash + 1));
  if (!resolved) {
    throw new Error(`Pi model not found: ${model}`);
  }
  return resolved;
}

export class PiSdkHarness implements BoundHarness {
  readonly type = 'pi-sdk' as const;
  readonly displayName = 'Pi (SDK)';

  readonly cwd: string;
  private closed = false;
  private readonly sessions = new Map<string, PiSdkSession>();
  private readonly modelRuntime: ModelRuntime;

  constructor(cwd: string, modelRuntime: ModelRuntime) {
    this.cwd = cwd;
    this.modelRuntime = modelRuntime;
  }

  async models(): Promise<readonly ModelInfo[]> {
    return (await this.modelRuntime.getAvailable()).map((entry) => ({
      id: `${entry.provider}/${entry.id}`,
      name: entry.id,
      provider: entry.provider,
    }));
  }

  async listAgents(): Promise<readonly PublishedAgent[]> {
    return [{ name: 'builder', mode: 'primary' }];
  }

  async listProviders(): Promise<readonly PublishedProvider[]> {
    const byProvider = new Map<string, { modelID: string; name: string }[]>();

    for (const entry of await this.modelRuntime.getAvailable()) {
      const models = byProvider.get(entry.provider) ?? [];
      models.push({ modelID: entry.id, name: entry.id });
      byProvider.set(entry.provider, models);
    }

    return [...byProvider.entries()].map(([providerID, models]) => ({
      providerID,
      name: providerID,
      models,
    }));
  }

  // fallow-ignore-next-line complexity
  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const model = requireHarnessModel(config.model, 'pi-sdk newSession');
    const { SessionManager } = await loadSdk();
    const session = await this.openAgentSession({
      systemPrompt: config.systemPrompt ?? '',
      model,
      sessionManager: SessionManager.create(getPiSessionDir(this.cwd)),
      requireModel: true,
    });
    const piSession = new PiSdkSession({
      session,
      opencodeSessionId: session.sessionId,
      sessionTitle: config.title ?? '',
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(session.sessionId, piSession);
    return piSession;
  }

  async resumeSession(
    sessionId: OpenCodeSessionId,
    options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const { SessionManager } = await loadSdk();

    const sessions = await SessionManager.list(this.cwd, getPiSessionDir(this.cwd));
    const match = sessions.find((s) => s.id === sessionId);
    if (!match) {
      throw new Error(`Session ${sessionId} not found on the harness`);
    }

    const session = await this.openAgentSession({
      systemPrompt: '',
      model: options?.model,
      sessionManager: SessionManager.open(match.path, getPiSessionDir(this.cwd)),
      requireModel: false,
    });

    const piSession = new PiSdkSession({
      session,
      opencodeSessionId: session.sessionId,
      sessionTitle: match.name ?? '',
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(session.sessionId, piSession);
    return piSession;
  }

  async fetchSessionTitle(_opencodeSessionId: string): Promise<string | undefined> {
    return undefined;
  }

  isAlive(): boolean {
    return !this.closed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const closing = [...this.sessions.values()].map((s) => s.close().catch(() => {}));
    await Promise.all(closing);
    this.sessions.clear();
  }

  // fallow-ignore-next-line complexity
  private async openAgentSession(args: {
    systemPrompt: string;
    sessionManager: PiSessionManager;
    model?: string | undefined;
    requireModel: boolean;
  }): Promise<AgentSession> {
    const { createAgentSession, DefaultResourceLoader, getAgentDir } = await loadSdk();

    const parsed = args.model ? parsePiSpawnModel(args.model) : undefined;
    const modelSlug = parsed?.model ?? args.model;
    const resolvedModel = args.requireModel
      ? resolveRequiredModel(
          this.modelRuntime,
          requireHarnessModel(modelSlug, 'pi-sdk openAgentSession')
        )
      : modelSlug
        ? resolveRequiredModel(this.modelRuntime, modelSlug)
        : undefined;
    const thinkingLevel = resolvePiThinkingLevel(parsed?.thinking);

    if (args.requireModel && !resolvedModel) {
      throw new Error(
        'No Pi model available — configure provider credentials in ~/.pi/agent/auth.json'
      );
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => args.systemPrompt,
    });
    await resourceLoader.reload();

    const { session } = await withTimeout(
      createAgentSession({
        cwd: this.cwd,
        sessionManager: args.sessionManager,
        modelRuntime: this.modelRuntime,
        resourceLoader,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'createAgentSession'
    );

    return session;
  }
}

export const startPiSdkHarness: BoundHarnessFactory = async (config) => {
  try {
    const sdk = await loadSdk();
    const modelRuntime = await sdk.ModelRuntime.create();
    if ((await modelRuntime.getAvailable()).length === 0) {
      throw new Error('No Pi models available');
    }
    return new PiSdkHarness(config.workingDir, modelRuntime);
  } catch (err) {
    throw new Error(`pi-sdk unavailable: ${formatPiSdkLoadError(err)}`);
  }
};
