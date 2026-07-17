/**
 * Shared bash heredoc delimiters for CLI stdin examples and agent-generated commands.
 *
 * Use namespaced terminators instead of generic `EOF` so handoff message bodies
 * (templates, code blocks, shell examples) cannot prematurely close the heredoc.
 */

/** Bash heredoc terminator for `chatroom handoff` message stdin. */
export const HANDOFF_STDIN_DELIMITER = 'CHATROOM_HANDOFF_END';

/** Bash heredoc terminator for `chatroom context new` stdin. */
export const CONTEXT_STDIN_DELIMITER = 'CHATROOM_CONTEXT_END';

/** Bash heredoc terminator for `chatroom backlog add` / `update` stdin. */
export const BACKLOG_STDIN_DELIMITER = 'CHATROOM_BACKLOG_END';

/** Bash heredoc terminator for `chatroom agentic-query complete` stdin. */
export const AGENTIC_QUERY_STDIN_DELIMITER = 'CHATROOM_AGENTIC_QUERY_END';

/** Bash heredoc terminator for structured multi-param commands (e.g. classify). */
const CLASSIFY_STDIN_DELIMITER = 'CHATROOM_CLASSIFY_END';

/** Optional first line inside handoff stdin; CLI strips it in single-param decode mode. */
export const HANDOFF_MESSAGE_MARKER = '---MESSAGE---';

const RESERVED_STDIN_HEREDOC_DELIMITERS = [
  HANDOFF_STDIN_DELIMITER,
  CONTEXT_STDIN_DELIMITER,
  BACKLOG_STDIN_DELIMITER,
  AGENTIC_QUERY_STDIN_DELIMITER,
  CLASSIFY_STDIN_DELIMITER,
] as const;

const RESERVED_STRUCTURED_PARAM_MARKERS = [
  HANDOFF_MESSAGE_MARKER,
  '---RESULT---',
  '---TITLE---',
  '---DESCRIPTION---',
  '---TECH_SPECS---',
] as const;

export interface StdinHeredocOptions {
  /** Optional marker line immediately after the heredoc opener (stripped by CLI decode). */
  messageMarker?: string;
}

/**
 * Format a bash command that reads multi-line stdin via a quoted heredoc.
 *
 * @example
 * formatStdinHeredocCommand(
 *   'chatroom handoff --chatroom-id="x" --role="builder" --next-role="planner"',
 *   HANDOFF_STDIN_DELIMITER,
 *   '[Your message here]',
 *   { messageMarker: HANDOFF_MESSAGE_MARKER }
 * )
 */
export function formatStdinHeredocCommand(
  commandPrefix: string,
  delimiter: string,
  placeholder: string,
  options?: StdinHeredocOptions
): string {
  const marker = options?.messageMarker;
  const body = marker ? `${marker}\n${placeholder}` : placeholder;
  return `${commandPrefix} << '${delimiter}'\n${body}\n${delimiter}`;
}

/** Returns true when content contains the heredoc terminator on its own line. */
function stdinBodyContainsHeredocDelimiter(content: string, delimiter: string): boolean {
  return content.split('\n').some((line) => line.trim() === delimiter);
}

/**
 * Validate stdin body does not contain the bash heredoc terminator.
 * @throws Error when the delimiter appears on its own line inside the body
 */
export function validateStdinHeredocBody(
  content: string,
  delimiter: string,
  contentLabel = 'Message'
): void {
  if (!stdinBodyContainsHeredocDelimiter(content, delimiter)) {
    return;
  }
  throw new Error(
    `${contentLabel} cannot contain the line '${delimiter}' — that line ends the shell heredoc. ` +
      `Rephrase or remove that line from the ${contentLabel.toLowerCase()}.`
  );
}

/** Returns reserved delimiter/marker lines found in template text (own-line matches only). */
// fallow-ignore-next-line unused-export
export function findReservedDelimiterLines(content: string): string[] {
  const reserved = new Set<string>([
    ...RESERVED_STDIN_HEREDOC_DELIMITERS,
    ...RESERVED_STRUCTURED_PARAM_MARKERS,
    'EOF',
  ]);
  const hits: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (reserved.has(trimmed) && !hits.includes(trimmed)) {
      hits.push(trimmed);
    }
  }
  return hits;
}
