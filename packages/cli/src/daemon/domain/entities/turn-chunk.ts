/**
 * A typed chunk of content extracted from a harness session event.
 *
 * Defined in the domain layer so infrastructure can import the type without
 * inverting the dependency direction.
 */
export interface ExtractedChunk {
  /** The incremental text content of this chunk. */
  readonly content: string;
  /** The opencode SDK messageID — groups all tokens of one agent response into a turn. */
  readonly messageId: string;
  /** Whether this chunk is reasoning (thinking) or regular text output. */
  readonly partType: 'text' | 'reasoning';
}
