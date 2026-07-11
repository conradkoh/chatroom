/**
 * ClaudeSdkHarness — BoundHarness implementation using @anthropic-ai/claude-agent-sdk in-process.
 */

import { randomUUID } from 'node:crypto';

import { ClaudeSdkSession } from './claude-session.js';
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
import {
  CLAUDE_FALLBACK_MODELS,
  fetchClaudeModels,
} from '../../services/remote-agents/claude/claude-models.js';
import {
  formatClaudeSdkLoadError,
  importBundledClaudeSdk,
  resolvePathToClaudeCodeExecutable,
} from '../../services/remote-agents/claude-sdk/claude-sdk-package.js';

const DEFAULT_MODEL = 'anthropic/sonnet';

type LoadedClaudeSdk = Awaited<ReturnType<typeof importBundledClaudeSdk>>;

let _sdkCache: LoadedClaudeSdk | undefined;
let _sdkLoadError: unknown;
let _executablePathCache: string | undefined;

async function loadSdk(): Promise<LoadedClaudeSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledClaudeSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

async function loadExecutablePath(): Promise<string> {
  if (_executablePathCache) return _executablePathCache;
  _executablePathCache = await resolvePathToClaudeCodeExecutable();
  return _executablePathCache;
}

// fallow-ignore-next-line unused-export
export class ClaudeSdkHarness implements BoundHarness {
  readonly type = 'claude-sdk' as const;
  readonly displayName = 'Claude (SDK)';

  readonly cwd: string;
  private readonly query: LoadedClaudeSdk['query'];
  private readonly executablePath: string;
  private closed = false;
  private readonly sessions = new Map<string, ClaudeSdkSession>();

  constructor(cwd: string, sdk: LoadedClaudeSdk, executablePath: string) {
    this.cwd = cwd;
    this.query = sdk.query;
    this.executablePath = executablePath;
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
    const dynamic = await fetchClaudeModels();
    const modelIds = dynamic ?? [...CLAUDE_FALLBACK_MODELS];

    return [
      {
        providerID: 'anthropic',
        name: 'Anthropic',
        models: modelIds.map((modelID) => ({ modelID, name: modelID })),
      },
    ];
  }

  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const opencodeSessionId = randomUUID();
    const session = new ClaudeSdkSession({
      cwd: this.cwd,
      executablePath: this.executablePath,
      query: this.query,
      opencodeSessionId,
      sessionTitle: config.title ?? '',
      defaultModel: config.model ?? DEFAULT_MODEL,
      systemPrompt: config.systemPrompt,
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(opencodeSessionId, session);
    return session;
  }

  // fallow-ignore-next-line code-duplication
  async resumeSession(
    sessionId: OpenCodeSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = new ClaudeSdkSession({
      cwd: this.cwd,
      executablePath: this.executablePath,
      query: this.query,
      opencodeSessionId: sessionId,
      sessionTitle: '',
      providerSessionId: sessionId,
      resumeOnFirstQuery: true,
      onClose: (id) => this.sessions.delete(id),
    });
    this.sessions.set(sessionId, session);
    return session;
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

export const startClaudeSdkHarness: BoundHarnessFactory = async (config) => {
  try {
    const sdk = await loadSdk();
    const executablePath = await loadExecutablePath();
    return new ClaudeSdkHarness(config.workingDir, sdk, executablePath);
  } catch (err) {
    throw new Error(`claude-sdk unavailable: ${formatClaudeSdkLoadError(err)}`);
  }
};
