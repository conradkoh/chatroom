import { randomUUID } from 'node:crypto';

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { withTimeout } from '../../services/remote-agents/with-timeout.js';

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_EFFORT = 'medium' as const;
const QUERY_TIMEOUT_MS = 3_600_000;

type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => Query;

export interface ClaudeSdkSessionOptions {
  readonly cwd: string;
  readonly executablePath: string;
  readonly query: QueryFn;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
  readonly defaultModel?: string;
  readonly systemPrompt?: string;
  readonly providerSessionId?: string;
  readonly resumeOnFirstQuery?: boolean;
  readonly onClose?: (sessionId: string) => void;
}

export class ClaudeSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  private _sessionTitle: string;
  // fallow-ignore-next-line unused-class-member
  get sessionTitle(): string {
    return this._sessionTitle;
  }

  private readonly cwd: string;
  private readonly executablePath: string;
  private readonly query: QueryFn;
  private readonly defaultModel?: string;
  private readonly storedSystemPrompt?: string;
  private readonly onClose?: (sessionId: string) => void;
  private readonly listeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  private providerSessionId?: string;
  private resumeOnFirstQuery: boolean;
  private isFirstQuery = true;
  private activeQuery?: Query;
  private sawTextDelta = false;
  private sawThinkingDelta = false;

  constructor(options: ClaudeSdkSessionOptions) {
    this.cwd = options.cwd;
    this.executablePath = options.executablePath;
    this.query = options.query;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.defaultModel = options.defaultModel;
    this.storedSystemPrompt = options.systemPrompt;
    this.providerSessionId = options.providerSessionId;
    this.resumeOnFirstQuery = options.resumeOnFirstQuery ?? false;
    this.onClose = options.onClose;
  }

  // fallow-ignore-next-line unused-class-member
  setTitle(title: string): void {
    this._sessionTitle = title;
  }

  // fallow-ignore-next-line unused-class-member complexity
  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');

    const text = input.parts.map((p) => p.text).join('\n');
    const messageId = randomUUID();
    const model = resolveClaudeModel(this.defaultModel, input.model);

    const useResume =
      Boolean(this.providerSessionId) && (!this.isFirstQuery || this.resumeOnFirstQuery);

    this.sawTextDelta = false;
    this.sawThinkingDelta = false;

    const queryInstance = this.query({
      prompt: text,
      options: {
        cwd: this.cwd,
        model,
        maxTurns: DEFAULT_MAX_TURNS,
        pathToClaudeCodeExecutable: this.executablePath,
        includePartialMessages: true,
        systemPrompt:
          this.isFirstQuery && !this.resumeOnFirstQuery ? this.storedSystemPrompt : undefined,
        resume: useResume ? this.providerSessionId : undefined,
        settingSources: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        effort: DEFAULT_EFFORT,
        canUseTool: async (_toolName: string, toolInput: unknown) => ({
          behavior: 'allow',
          updatedInput: toolInput,
        }),
      },
    });

    this.activeQuery = queryInstance;
    if (this.resumeOnFirstQuery) {
      this.resumeOnFirstQuery = false;
    }
    this.isFirstQuery = false;

    try {
      await withTimeout(
        // fallow-ignore-next-line complexity
        (async () => {
          for await (const message of queryInstance) {
            if (this.closed) break;
            this.captureProviderSessionId(message);
            this.emitFromSdkMessage(message, messageId);
            if (message.type === 'result') {
              if (message.is_error) {
                const errors =
                  'errors' in message && Array.isArray(message.errors)
                    ? message.errors.join('; ')
                    : 'turn failed';
                throw new Error(errors);
              }
              break;
            }
          }
        })(),
        QUERY_TIMEOUT_MS,
        'query'
      );
    } finally {
      this.activeQuery = undefined;
    }

    this.emit({ type: 'session.idle', payload: {}, timestamp: Date.now() });
  }

  // fallow-ignore-next-line unused-class-member
  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // fallow-ignore-next-line unused-class-member
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.activeQuery?.interrupt();
    } catch {
      // Best-effort
    }
    this.activeQuery = undefined;
    this.onClose?.(this.opencodeSessionId);
    this.listeners.clear();
  }

  private emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitDelta(messageId: string, delta: string, partType: 'text' | 'reasoning'): void {
    if (!delta) return;
    this.emit({
      type: 'message.part.delta',
      payload: { messageID: messageId, delta, partType },
      timestamp: Date.now(),
    });
  }

  // fallow-ignore-next-line complexity
  private captureProviderSessionId(message: SDKMessage): void {
    if (!('session_id' in message) || typeof message.session_id !== 'string') {
      return;
    }
    const sessionId = message.session_id;
    if (this.providerSessionId === sessionId) {
      return;
    }
    const isFirstAllocation = !this.providerSessionId;
    this.providerSessionId = sessionId;
    if (isFirstAllocation) {
      this.emit({
        type: 'session.provider_id',
        payload: { sessionId },
        timestamp: Date.now(),
      });
    }
  }

  // fallow-ignore-next-line complexity
  private emitFromSdkMessage(message: SDKMessage, messageId: string): void {
    switch (message.type) {
      case 'stream_event': {
        const event = message.event;
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            this.sawTextDelta = true;
            this.emitDelta(messageId, delta.text, 'text');
          } else if (delta.type === 'thinking_delta') {
            this.sawThinkingDelta = true;
            this.emitDelta(messageId, delta.thinking, 'reasoning');
          }
        }
        break;
      }
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            if (!this.sawTextDelta) {
              this.emitDelta(messageId, block.text, 'text');
            }
          } else if (block.type === 'thinking' && block.thinking) {
            if (!this.sawThinkingDelta) {
              this.emitDelta(messageId, block.thinking, 'reasoning');
            }
          }
        }
        break;
      default:
        break;
    }
  }
}

// fallow-ignore-next-line complexity
function resolveClaudeModel(
  defaultModel?: string,
  promptModel?: { readonly providerID: string; readonly modelID: string }
): string {
  if (promptModel) {
    if (promptModel.providerID === 'anthropic') return promptModel.modelID;
    return promptModel.modelID;
  }
  if (defaultModel) {
    const slash = defaultModel.indexOf('/');
    if (slash === -1) return defaultModel;
    const provider = defaultModel.slice(0, slash);
    const modelId = defaultModel.slice(slash + 1);
    if (provider === 'anthropic') return modelId;
    return modelId;
  }
  return 'sonnet';
}
