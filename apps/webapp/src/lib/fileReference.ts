/**
 * File reference encoding/decoding for chat messages.
 *
 * Format: `{file://<workspace>/<filePath>}`
 *
 * Escaping rules:
 * - `\{file://` is a literal (not a reference)
 * - `\}` inside a reference is a literal `}` (not the closing delimiter)
 *
 * This module is pure TypeScript — no React dependencies.
 */

/** A decoded file reference with its position in the source text. */
export interface FileReference {
  workspace: string;
  filePath: string;
  /** Start index (inclusive) of the reference in the original text. */
  start: number;
  /** End index (exclusive) of the reference in the original text. */
  end: number;
}

const FILE_REF_PREFIX = '{file://';

/**
 * Encode a file reference into the `{file://workspace/path}` format.
 *
 * Closing braces in the workspace or path are escaped as `\}`.
 *
 * @throws if workspace or filePath is empty.
 */
export function encodeFileReference(workspace: string, filePath: string): string {
  if (!workspace) throw new Error('workspace must not be empty');
  if (!filePath) throw new Error('filePath must not be empty');

  const escapedWorkspace = workspace.replace(/\}/g, '\\}');
  const escapedPath = filePath.replace(/\}/g, '\\}');

  return `${FILE_REF_PREFIX}${escapedWorkspace}/${escapedPath}}`;
}

/**
 * Decode all file references from a text string.
 *
 * Respects escape sequences:
 * - `\{file://` is treated as literal text (skipped)
 * - `\}` inside a reference is treated as a literal `}`
 *
 * Returns references with their positions in the original text.
 */
export function decodeFileReferences(text: string): FileReference[] {
  if (!text) return [];

  const refs: FileReference[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const idx = text.indexOf(FILE_REF_PREFIX, searchFrom);
    if (idx === -1) break;

    // Check if this is escaped (preceded by backslash)
    if (idx > 0 && text[idx - 1] === '\\') {
      searchFrom = idx + FILE_REF_PREFIX.length;
      continue;
    }

    // Find the closing brace, respecting escaped braces
    const contentStart = idx + FILE_REF_PREFIX.length;
    let closingIdx = -1;

    for (let i = contentStart; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length && text[i + 1] === '}') {
        // Skip escaped closing brace
        i++; // will be incremented again by the loop
        continue;
      }
      if (text[i] === '}') {
        closingIdx = i;
        break;
      }
    }

    if (closingIdx === -1) {
      // No closing brace found — not a valid reference
      searchFrom = contentStart;
      continue;
    }

    // Extract the raw content between {file:// and }
    const rawContent = text.slice(contentStart, closingIdx);

    // Unescape \} to }
    const unescaped = rawContent.replace(/\\\}/g, '}');

    // Split workspace and path at the first /
    const firstSlash = unescaped.indexOf('/');
    if (firstSlash === -1 || firstSlash === 0 || firstSlash === unescaped.length - 1) {
      // Invalid format — no slash, or empty workspace/path
      searchFrom = closingIdx + 1;
      continue;
    }

    const workspace = unescaped.slice(0, firstSlash);
    const filePath = unescaped.slice(firstSlash + 1);

    refs.push({
      workspace,
      filePath,
      start: idx,
      end: closingIdx + 1,
    });

    searchFrom = closingIdx + 1;
  }

  return refs;
}

/**
 * Escape literal `{file://` occurrences in user text so they aren't
 * interpreted as file references.
 *
 * Adds a backslash before `{file://` unless already escaped.
 */
export function escapeFileReferenceLiterals(text: string): string {
  if (!text) return text;

  // Replace {file:// that is NOT preceded by a backslash
  // Use a negative lookbehind to avoid double-escaping
  return text.replace(/(?<!\\)\{file:\/\//g, '\\{file://');
}
