/**
 * PiSdkHarness — BoundHarness implementation using @earendil-works/pi-coding-agent in-process.
 */

import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { PiSdkSession } from './pi-session.js';
import type {
  BoundHarness,
  BoundHarnessFactory,
  ModelInfo,
  NewSessionConfig,
  ResumeHarnessSessionOptions,
} from '../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import type {
  PublishedAgent,
  PublishedProvider,
} from '../../../domain/direct-harness/entities/machine-capabilities.js';
import { getPiSessionDir } from '../../services/remote-agents/pi/pi-agent-service.js';
import {
  formatPiSdkLoadError,
  importBundledPiSdk,
} from '../../services/remote-agents/pi-sdk/pi-sdk-package.js';
import { withTimeout } from '../../services/remote-agents/with-timeout.js';

const SESSION_CREATE_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'opencode/big-pickle';

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

type PiModelRegistry = ReturnType<LoadedPiSdk['ModelRegistry']['create']>;
type PiAuthStorage = ReturnType<LoadedPiSdk['AuthStorage']['create']>;

function resolveModel(modelRegistry: PiModelRegistry, model?: string) {
  if (model) {
    const slash = model.indexOf('/');
    if (slash === -1) {
      return modelRegistry.getAll().find((entry: { id: string }) => entry.id === model);
    }
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    return modelRegistry.find(provider, modelId);
  }
  return modelRegistry.getAvailable()[0];
}

export class PiSdkHarness implements BoundHarness {
  readonly type = 'pi-sdk' as const;
  readonly displayName = 'Pi (SDK)';

  readonly cwd: string;
  private closed = false;
  private readonly sessions = new Map<string, PiSdkSession>();
  private readonly modelRegistry: PiModelRegistry;
  private readonly authStorage: PiAuthStorage;

  constructor(cwd: string, modelRegistry: PiModelRegistry, authStorage: PiAuthStorage) {
    this.cwd = cwd;
    this.modelRegistry = modelRegistry;
    this.authStorage = authStorage;
  }

  async models(): Promise<readonly ModelInfo[]> {
    return this.modelRegistry.getAvailable().map((entry: { provider: string; id: string }) => ({
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

    for (const entry of this.modelRegistry.getAvailable() as { provider: string; id: string }[]) {
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

  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const session = await this.createAgentSession(config.systemPrompt ?? '', config.model);
    const piSession = new PiSdkSession({
      session,
      opencodeSessionId: session.sessionId,
      sessionTitle: config.title ?? '',
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(session.sessionId, piSession);
    return piSession;
  }

  // fallow-ignore-next-line complexity
  async resumeSession(
    sessionId: OpenCodeSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } =
      await loadSdk();

    const sessions = await SessionManager.list(this.cwd, getPiSessionDir(this.cwd));
    const match = sessions.find((s) => s.id === sessionId);
    if (!match) {
      throw new Error(`Session ${sessionId} not found on the harness`);
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => '',
    });
    await resourceLoader.reload();

    const resolvedModel = resolveModel(this.modelRegistry);
    if (!resolvedModel) {
      throw new Error('No Pi model available');
    }

    const { session } = await withTimeout(
      createAgentSession({
        cwd: this.cwd,
        model: resolvedModel,
        sessionManager: SessionManager.open(match.path, getPiSessionDir(this.cwd)),
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        resourceLoader,
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'createAgentSession'
    );

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

  private async createAgentSession(systemPrompt: string, model?: string): Promise<AgentSession> {
    const { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } =
      await loadSdk();
    const resolvedModel = resolveModel(this.modelRegistry, model ?? DEFAULT_MODEL);
    if (!resolvedModel) {
      throw new Error(
        'No Pi model available — configure provider credentials in ~/.pi/agent/auth.json'
      );
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
    });
    await resourceLoader.reload();

    const { session } = await withTimeout(
      createAgentSession({
        cwd: this.cwd,
        model: resolvedModel,
        sessionManager: SessionManager.create(getPiSessionDir(this.cwd)),
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        resourceLoader,
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'createAgentSession'
    );

    return session;
  }
}

export const startPiSdkHarness: BoundHarnessFactory = async (config) => {
  try {
    const { AuthStorage, ModelRegistry } = await loadSdk();
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    if (modelRegistry.getAvailable().length === 0) {
      throw new Error('No Pi models available');
    }
    return new PiSdkHarness(config.workingDir, modelRegistry, authStorage);
  } catch (err) {
    throw new Error(`pi-sdk unavailable: ${formatPiSdkLoadError(err)}`);
  }
};
