/**
 * DirectHarnessSession implementation for the opencode SDK harness.
 *
 * Wraps a session on the opencode SDK client process, providing
 * prompt/onEvent/close as specified by the DirectHarnessSession domain interface.
 */

import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

export interface OpencodeSdkSessionOptions {
  /** The opencode SDK client instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any;
  /** Harness-issued session identifier. */
  readonly harnessSessionId: string;
  /** Human-readable title for the session. */
  readonly sessionTitle: string;
}

export class OpencodeSdkSession implements DirectHarnessSession {
  readonly harnessSessionId: HarnessSessionId;
  readonly sessionTitle: string;

  constructor(private readonly options: OpencodeSdkSessionOptions) {
    this.harnessSessionId = options.harnessSessionId as HarnessSessionId;
    this.sessionTitle = options.sessionTitle;
  }

  async prompt(input: PromptInput): Promise<void> {
    // TODO: Implement — send a structured prompt to the opencode SDK session
    throw new Error('Not implemented');
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    // TODO: Implement — subscribe to SSE events from the opencode process
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    // TODO: Implement — close the session on the opencode process
    throw new Error('Not implemented');
  }

  /** Internal: emit an event to all subscribed listeners. */
  _emit(event: DirectHarnessSessionEvent): void {
    // TODO: implement event dispatch
    throw new Error('Not implemented');
  }
}
