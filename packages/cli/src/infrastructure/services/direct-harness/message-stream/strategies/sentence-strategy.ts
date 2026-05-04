/**
 * @deprecated Sentence-based flush is not used in the new architecture.
 *             BufferedJournalFactory uses a time-based interval instead.
 *
 * Flushes when the last buffered chunk ends with a sentence terminator.
 */

import type { FlushStrategy, FlushContext } from '../../../../../domain/direct-harness/ports/index.js';

/** Regex for sentence-ending punctuation, optionally followed by closing quotes/parens and whitespace. */
const SENTENCE_END_RE = /[.!?]["')\]]?\s*$/;

/**
 * Triggers a flush when the most recent buffered item's `content` field ends with
 * a sentence terminator (. ! ?) optionally followed by closing punctuation and whitespace.
 * Items without a `content` field are ignored (no flush triggered).
 */
export class SentenceFlushStrategy implements FlushStrategy {
  readonly name = 'sentence';

  shouldFlush<T>(buffer: readonly T[], _ctx: FlushContext): boolean {
    if (buffer.length === 0) return false;
    const last = buffer[buffer.length - 1];
    const content =
      last !== null &&
      typeof last === 'object' &&
      'content' in (last as object) &&
      typeof (last as Record<string, unknown>)['content'] === 'string'
        ? ((last as Record<string, unknown>)['content'] as string)
        : '';
    return SENTENCE_END_RE.test(content);
  }
}
