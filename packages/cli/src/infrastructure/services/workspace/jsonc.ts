/**
 * Minimal JSONC (JSON with Comments) parser.
 *
 * `turbo.json` and similar tooling configs are JSONC: they may contain `//`
 * line comments, `/* *\/` block comments, and trailing commas. The standard
 * `JSON.parse` rejects all of these, which previously caused command
 * discovery to silently skip every turbo task whenever `turbo.json` contained
 * a comment (see command-discovery.ts).
 *
 * The stripping is string-aware: each regex matches a COMPLETE string literal
 * as its first alternative, so comment markers and commas appearing inside a
 * string value — for example the `//` in `"https://turbo.build/schema.json"` —
 * are matched as part of the string and returned untouched. Only structural
 * comments and trailing commas are removed before `JSON.parse`.
 */

/** Matches a full JSON string literal (with escapes), OR a line/block comment. */
const STRING_OR_COMMENT = /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Matches a full JSON string literal, OR a comma that precedes a `}` or `]`. */
const STRING_OR_TRAILING_COMMA = /("(?:\\.|[^"\\])*")|,(?=\s*[}\]])/g;

/**
 * Parse JSONC content into a value, tolerating comments and trailing commas.
 *
 * @throws SyntaxError when the comment-stripped content is still not valid JSON.
 */
export function parseJsonc<T = unknown>(content: string): T {
  const withoutComments = content.replace(STRING_OR_COMMENT, (_match, str) => str ?? '');
  const sanitized = withoutComments.replace(STRING_OR_TRAILING_COMMA, (_match, str) => str ?? '');
  return JSON.parse(sanitized) as T;
}
