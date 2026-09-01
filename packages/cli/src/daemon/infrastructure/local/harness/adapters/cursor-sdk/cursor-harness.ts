/**
 * CursorSdkHarness — BoundHarness implementation using @cursor/sdk in-process.
 */

import { CursorSdkSession } from './cursor-session.js';
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
import { resolveCursorSdkSpawnModelSelection } from '../../services/cursor-sdk/cursor-models.js';
import { fetchCursorSdkModelCatalog } from '../../services/cursor-sdk/cursor-sdk-model-catalog.js';
import {
  formatCursorSdkLoadError,
  importBundledCursorSdk,
} from '../../services/cursor-sdk/cursor-sdk-package.js';
import { requireHarnessModel } from '../../services/require-harness-model.js';
import { withTimeout } from '../../services/with-timeout.js';

const AGENT_CREATE_TIMEOUT_MS = 60_000;

type LoadedCursorSdk = Awaited<ReturnType<typeof importBundledCursorSdk>>;

let _sdkCache: LoadedCursorSdk | undefined;
let _sdkLoadError: unknown;

async function loadSdk(): Promise<LoadedCursorSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledCursorSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

export class CursorSdkHarness implements BoundHarness {
  readonly type = 'cursor-sdk' as const;
  readonly displayName = 'Cursor (SDK)';

  readonly cwd: string;
  private closed = false;
  private readonly sessions = new Map<string, CursorSdkSession>();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async models(): Promise<readonly ModelInfo[]> {
    const providers = await this.listProviders();
    const models: ModelInfo[] = [];
    for (const provider of providers) {
      for (const model of provider.models) {
        models.push({
          id: `${provider.providerID}/${model.modelID}`,
          name: model.name,
          provider: provider.name,
        });
      }
    }
    return models;
  }

  async listAgents(): Promise<readonly PublishedAgent[]> {
    return [{ name: 'builder', mode: 'primary' }];
  }

  async listProviders(): Promise<readonly PublishedProvider[]> {
    const modelIds = await fetchCursorSdkModelCatalog();

    return [
      {
        providerID: 'cursor',
        name: 'Cursor',
        models: modelIds.map((modelID) => ({ modelID, name: modelID })),
      },
    ];
  }

  private requireApiKey(): string {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) throw new Error('CURSOR_API_KEY is not set');
    return apiKey;
  }

  private registerAgentSession(
    agent: Awaited<ReturnType<LoadedCursorSdk['Agent']['create']>>,
    sessionTitle: string
  ): DirectHarnessSession {
    const session = new CursorSdkSession({
      agent,
      opencodeSessionId: agent.agentId,
      sessionTitle,
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(agent.agentId, session);
    return session;
  }

  // fallow-ignore-next-line complexity
  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const apiKey = this.requireApiKey();
    const model = requireHarnessModel(config.model, 'cursor-sdk newSession');
    const modelSelection = resolveCursorSdkSpawnModelSelection(model);
    const { Agent } = await loadSdk();
    const agent = await withTimeout(
      Agent.create({
        apiKey,
        model: modelSelection,
        local: { cwd: this.cwd, settingSources: [], enableAgentRetries: true },
      }),
      AGENT_CREATE_TIMEOUT_MS,
      'Agent.create'
    );

    return this.registerAgentSession(agent, config.title ?? '');
  }

  async resumeSession(
    sessionId: OpenCodeSessionId,
    options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const model = requireHarnessModel(options?.model, 'cursor-sdk resumeSession');
    const apiKey = this.requireApiKey();
    const { Agent } = await loadSdk();
    const agent = await withTimeout(
      Agent.resume(sessionId, {
        apiKey,
        model: resolveCursorSdkSpawnModelSelection(model),
        local: { cwd: this.cwd, settingSources: [], enableAgentRetries: true },
      }),
      AGENT_CREATE_TIMEOUT_MS,
      'Agent.resume'
    );

    return this.registerAgentSession(agent, '');
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
}

export const startCursorSdkHarness: BoundHarnessFactory = async (config) => {
  try {
    await loadSdk();
  } catch (err) {
    throw new Error(`cursor-sdk unavailable: ${formatCursorSdkLoadError(err)}`);
  }

  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new Error('CURSOR_API_KEY is not set');
  }

  return new CursorSdkHarness(config.workingDir);
};
