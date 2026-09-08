import { randomUUID } from 'node:crypto';

/** Terminal states for one provider turn. Process lifetime is tracked separately. */
export type TurnCompletionStatus =
  'completed' | 'failed' | 'aborted' | 'timed_out' | 'process_exited';

export interface TurnCompletionResult {
  readonly turnId: string;
  readonly status: TurnCompletionStatus;
  /** Provider/transport observation that caused the terminal decision. */
  readonly source: string;
  readonly providerTurnId?: string | undefined;
  readonly error?: string | undefined;
}

export type TurnCompletionInput = Omit<TurnCompletionResult, 'turnId'>;

export interface TurnCompletion {
  readonly turnId: string;
  /** Resolves exactly once, when the turn reaches any terminal state. */
  readonly result: Promise<TurnCompletionResult>;
  /** Returns false when another terminal result already won the race. */
  complete(input: TurnCompletionInput): boolean;
  /** Registers a listener, invoking it immediately when already complete. */
  onComplete(listener: (result: TurnCompletionResult) => void): () => void;
  readonly isComplete: boolean;
  readonly value: TurnCompletionResult | undefined;
}

export function createTurnCompletion(turnId = randomUUID()): TurnCompletion {
  let resolveResult!: (result: TurnCompletionResult) => void;
  let value: TurnCompletionResult | undefined;
  const listeners = new Set<(result: TurnCompletionResult) => void>();
  const result = new Promise<TurnCompletionResult>((resolve) => {
    resolveResult = resolve;
  });

  return {
    turnId,
    result,
    get isComplete() {
      return value !== undefined;
    },
    get value() {
      return value;
    },
    complete(input) {
      if (value !== undefined) return false;
      value = { ...input, turnId };
      resolveResult(value);
      for (const listener of listeners) listener(value);
      listeners.clear();
      return true;
    },
    onComplete(listener) {
      if (value !== undefined) {
        listener(value);
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function turnCompletionFromError(error: unknown, source: string): TurnCompletionInput {
  const message = error instanceof Error ? error.message : String(error);
  const status: TurnCompletionStatus = /timed out after/i.test(message) ? 'timed_out' : 'failed';
  return { status, source, error: message };
}
