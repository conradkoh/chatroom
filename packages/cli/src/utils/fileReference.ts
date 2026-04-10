/**
 * File Reference Parsing Module
 *
 * Decodes workspace IDs and parses `{file://workspaceId/path}` file reference
 * tokens from chatroom messages. Self-contained — no webapp dependencies.
 *
 * Workspace ID encoding format: base64url(machineId + "::" + workingDir)
 */

// ============================================================================
// Types
// ============================================================================

export interface DecodedWorkspace {
  machineId: string;
  workingDir: string;
}

export interface ParsedFileReference {
  workspaceId: string;
  filePath: string;
}

export interface ExtractedFileReference extends ParsedFileReference {
  /** The raw matched token including braces, e.g. `{file://ws/path}` */
  raw: string;
  /** Start index in the source text */
  start: number;
  /** End index in the source text (exclusive) */
  end: number;
}

// ============================================================================
// Workspace ID Decoding
// ============================================================================

const SEPARATOR = '::';

/**
 * Decode a base64url-encoded workspace ID back to its (machineId, workingDir)
 * components.
 *
 * The encoding format is: `base64url(machineId + "::" + workingDir)`
 *
 * @throws {Error} if the encoded string is invalid base64url or missing the separator.
 */
export function decodeWorkspaceId(encoded: string): DecodedWorkspace {
  let raw: string;
  try {
    raw = Buffer.from(encoded, 'base64url').toString('utf-8');
  } catch {
    throw new Error('Invalid workspace ID: failed to decode base64url');
  }

  const separatorIdx = raw.indexOf(SEPARATOR);
  if (separatorIdx === -1) {
    throw new Error('Invalid workspace ID: missing separator');
  }

  return {
    machineId: raw.slice(0, separatorIdx),
    workingDir: raw.slice(separatorIdx + SEPARATOR.length),
  };
}

// ============================================================================
// File Reference Parsing
// ============================================================================

/**
 * Parse a single `{file://workspaceId/path}` token.
 *
 * @returns The parsed workspace ID and file path, or null if the token
 *          doesn't match the expected format.
 */
export function parseFileReference(token: string): ParsedFileReference | null {
  if (!token.startsWith('{file://') || !token.endsWith('}')) {
    return null;
  }

  // Strip braces and prefix: "{file://ws/path}" → "ws/path"
  const inner = token.slice('{file://'.length, -1);
  if (!inner) return null;

  const firstSlash = inner.indexOf('/');
  if (firstSlash === -1 || firstSlash === 0) {
    // No slash (workspace only) or empty workspace
    return null;
  }

  const workspaceId = inner.slice(0, firstSlash);
  const filePath = inner.slice(firstSlash + 1);

  if (!workspaceId || !filePath) return null;

  return { workspaceId, filePath };
}

/**
 * Extract all `{file://...}` references from a text string.
 *
 * Skips escaped references (preceded by a backslash: `\{file://...}`).
 * Returns matches with their positions in the source text.
 */
export function extractFileReferences(text: string): ExtractedFileReference[] {
  if (!text || !text.includes('{file://')) return [];

  const results: ExtractedFileReference[] = [];
  // Match {file://...} tokens — non-greedy to handle multiple refs on same line
  const regex = /\{file:\/\/[^}]+\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];

    // Skip escaped references (preceded by backslash)
    if (start > 0 && text[start - 1] === '\\') {
      continue;
    }

    const parsed = parseFileReference(raw);
    if (parsed) {
      results.push({
        ...parsed,
        raw,
        start,
        end: start + raw.length,
      });
    }
  }

  return results;
}
