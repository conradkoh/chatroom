/**
 * Workspace Identity Module
 *
 * Provides a collision-proof, URL-safe way to uniquely identify workspaces.
 * Replaces the directory-basename approach (e.g., "chatroom") that collides
 * when multiple machines share the same directory name.
 *
 * Encoding format: base64url(machineId + "::" + workingDir)
 * - Collision-proof: different (machineId, workingDir) pairs → different IDs
 * - URL-safe: only A-Z, a-z, 0-9, -, _ (no padding)
 * - Reversible: decode(encode(m, w)) === { machineId: m, workingDir: w }
 *
 * Known limitation: if machineId contains "::", decoding will split on the
 * first occurrence. Machine IDs in practice do not contain "::".
 */

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceIdentifier {
  machineId: string;
  workingDir: string;
  encodedId: string;
}

// ============================================================================
// Encoding / Decoding
// ============================================================================

const SEPARATOR = '::';

/**
 * Encode a (machineId, workingDir) pair into a URL-safe, collision-proof string.
 *
 * Uses base64url encoding (RFC 4648 §5) with no padding.
 * Works in the browser via btoa/atob.
 */
export function encodeWorkspaceId(machineId: string, workingDir: string): string {
  const raw = `${machineId}${SEPARATOR}${workingDir}`;
  // btoa expects a "binary string" — encode as UTF-8 bytes first to handle
  // non-ASCII characters safely.
  const utf8Bytes = new TextEncoder().encode(raw);
  const binaryStr = Array.from(utf8Bytes, (b) => String.fromCharCode(b)).join('');
  const base64 = btoa(binaryStr);
  // Convert standard base64 → base64url (no padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a workspace ID back to its (machineId, workingDir) components.
 *
 * @throws {Error} if the encoded string is invalid or missing the separator.
 */
export function decodeWorkspaceId(encoded: string): { machineId: string; workingDir: string } {
  // Convert base64url → standard base64
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Re-add padding
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(paddingNeeded);

  let raw: string;
  try {
    const binaryStr = atob(base64);
    const bytes = Uint8Array.from(binaryStr, (ch) => ch.charCodeAt(0));
    raw = new TextDecoder().decode(bytes);
  } catch {
    throw new Error(`Invalid workspace ID: failed to decode base64url`);
  }

  const separatorIdx = raw.indexOf(SEPARATOR);
  if (separatorIdx === -1) {
    throw new Error(`Invalid workspace ID: missing separator`);
  }

  return {
    machineId: raw.slice(0, separatorIdx),
    workingDir: raw.slice(separatorIdx + SEPARATOR.length),
  };
}

// ============================================================================
// Display
// ============================================================================

/**
 * Extract the last path segment of workingDir for display purposes.
 * This preserves the existing "workspace name" behavior.
 *
 * "/Users/alice/chatroom" → "chatroom"
 * "chatroom"              → "chatroom"
 * "/"                     → ""
 */
export function getWorkspaceDisplayName(workingDir: string): string {
  // Remove trailing slash(es) then take the last segment
  const trimmed = workingDir.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}
