/**
 * JSONC (JSON with Comments) parsing for tooling configs.
 *
 * `turbo.json` and similar configs are JSONC: they may contain `//` line
 * comments, `/* *\/` block comments, and trailing commas. The standard
 * `JSON.parse` rejects all of these, which previously caused command discovery
 * to silently skip every turbo task whenever `turbo.json` contained a comment
 * (see command-discovery.ts).
 *
 * Backed by `jsonc-parser` — the tokenizing parser used by VS Code and the
 * TypeScript tooling for `tsconfig.json` — rather than a hand-rolled regex
 * stripper, so comment markers embedded in strings (e.g. the `//` in
 * `"https://turbo.build/schema.json"`), escapes, and other edge cases are
 * handled by a real lexer rather than by pattern matching.
 */

// Bun resolves package "main" (UMD) which uses runtime require('./impl/*') and breaks
// when bundled into dist/index.js. The ESM entry uses static imports that bundle cleanly.
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser/lib/esm/main.js';

/**
 * Parse JSONC content into a value, tolerating comments and trailing commas.
 *
 * `jsonc-parser` is error-tolerant and returns a best-effort value rather than
 * throwing; we surface the first parse error as a `SyntaxError` so callers can
 * treat malformed config the same way they would a failed `JSON.parse`.
 *
 * @throws SyntaxError when the content is not valid JSONC.
 */
export function parseJsonc<T = unknown>(content: string): T {
  const errors: ParseError[] = [];
  const result = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T;

  if (errors.length > 0) {
    const { error, offset } = errors[0];
    throw new SyntaxError(`Invalid JSONC: ${printParseErrorCode(error)} at offset ${offset}`);
  }

  return result;
}
