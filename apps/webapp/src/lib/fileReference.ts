/**
 * File reference encoding/decoding for chat messages.
 *
 * New format (dynamic prefix): `<prefix>{file:<workspace>:<filePath>}`
 * Legacy format: `{file://<workspace>/<filePath>}`
 *
 * The prefix is a 6-char alphanumeric string unique per message, preventing
 * user-typed text from being misinterpreted as file references.
 *
 * Escaping rules:
 * - `\}` inside a reference is a literal `}` (not the closing delimiter)
 * - `\:` inside a workspace is a literal `:` (not the separator)
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

/**
 * Generate a 6-char random alphanumeric prefix for file reference tokens.
 * Used once per message to create a unique prefix.
 */
export function generateTokenPrefix(): string {
  // Pad with '0' in the extremely unlikely case of a short result
  return Math.random().toString(36).substring(2, 8).padEnd(6, '0');
}

/**
 * Encode a file reference into the `<prefix>{file:<workspace>:<filePath>}` format.
 *
 * Closing braces in the workspace or path are escaped as `\}`.
 * Colons in the workspace are escaped as `\:`.
 *
 * @throws if workspace or filePath is empty.
 */
export function encodeFileReference(workspace: string, filePath: string, prefix: string): string {
  if (!workspace) throw new Error('workspace must not be empty');
  if (!filePath) throw new Error('filePath must not be empty');
  if (!prefix) throw new Error('prefix must not be empty');

  const escapedWorkspace = workspace.replace(/\}/g, '\\}').replace(/:/g, '\\:');
  const escapedPath = filePath.replace(/\}/g, '\\}');

  return `<${prefix}>{file:${escapedWorkspace}:${escapedPath}}`;
}

/**
 * Decode all file references from a text string using the given prefix.
 *
 * Scans for `<prefix>{file:` patterns and extracts workspace/path.
 *
 * Respects escape sequences:
 * - `\}` inside a reference is treated as a literal `}`
 * - `\:` inside a workspace is treated as a literal `:`
 *
 * Returns references with their positions in the original text.
 */
export function decodeFileReferences(text: string, prefix: string): FileReference[] {
  if (!text || !prefix) return [];

  const marker = `<${prefix}>{file:`;
  const refs: FileReference[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const idx = text.indexOf(marker, searchFrom);
    if (idx === -1) break;

    const contentStart = idx + marker.length;

    // Find the closing brace, respecting escaped braces
    let closingIdx = -1;
    for (let i = contentStart; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length && (text[i + 1] === '}' || text[i + 1] === ':')) {
        i++; // skip escaped char
        continue;
      }
      if (text[i] === '}') {
        closingIdx = i;
        break;
      }
    }

    if (closingIdx === -1) {
      searchFrom = contentStart;
      continue;
    }

    const rawContent = text.slice(contentStart, closingIdx);

    // Split at first unescaped `:` to separate workspace from path
    let separatorIdx = -1;
    for (let i = 0; i < rawContent.length; i++) {
      if (rawContent[i] === '\\' && i + 1 < rawContent.length) {
        i++; // skip escaped char
        continue;
      }
      if (rawContent[i] === ':') {
        separatorIdx = i;
        break;
      }
    }

    if (separatorIdx === -1 || separatorIdx === 0 || separatorIdx === rawContent.length - 1) {
      searchFrom = closingIdx + 1;
      continue;
    }

    const rawWorkspace = rawContent.slice(0, separatorIdx);
    const rawPath = rawContent.slice(separatorIdx + 1);

    // Unescape
    const workspace = rawWorkspace.replace(/\\:/g, ':').replace(/\\\}/g, '}');
    const filePath = rawPath.replace(/\\\}/g, '}');

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

// ── Legacy format support ──────────────────────────────────────────────────

const LEGACY_PREFIX = '{file://';

/**
 * Decode file references using the legacy `{file://workspace/path}` format.
 * Used for backward compatibility with old messages.
 */
export function decodeFileReferencesLegacy(text: string): FileReference[] {
  if (!text) return [];

  const refs: FileReference[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const idx = text.indexOf(LEGACY_PREFIX, searchFrom);
    if (idx === -1) break;

    // Check if escaped
    if (idx > 0 && text[idx - 1] === '\\') {
      searchFrom = idx + LEGACY_PREFIX.length;
      continue;
    }

    const contentStart = idx + LEGACY_PREFIX.length;
    let closingIdx = -1;

    for (let i = contentStart; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length && text[i + 1] === '}') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        closingIdx = i;
        break;
      }
    }

    if (closingIdx === -1) {
      searchFrom = contentStart;
      continue;
    }

    const rawContent = text.slice(contentStart, closingIdx);
    const unescaped = rawContent.replace(/\\\}/g, '}');

    const firstSlash = unescaped.indexOf('/');
    if (firstSlash === -1 || firstSlash === 0 || firstSlash === unescaped.length - 1) {
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
