/** Directories that must not receive uploads (e.g. `.git`). */
const BLOCKED_UPLOAD_DIR_NAMES = new Set(['.git']);

const SECRET_PATH_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\./,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /credentials\.json$/,
  /^secrets(\/|$)/,
  /^\.aws(\/|$)/,
];

function isSecretPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasBlockedDirSegment(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some((segment) => BLOCKED_UPLOAD_DIR_NAMES.has(segment));
}

/** Returns true when a relative workspace path must not receive uploads. */
function isBlockedUploadTargetPath(relativePath: string): boolean {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  return isSecretPath(normalized) || hasBlockedDirSegment(normalized);
}

/** User-facing reason when an upload target path is blocked, or null if allowed. */
export function getBlockedUploadTargetReason(relativePath: string): string | null {
  if (!isBlockedUploadTargetPath(relativePath)) return null;
  return 'Cannot upload to this location (.git and sensitive paths are blocked)';
}
