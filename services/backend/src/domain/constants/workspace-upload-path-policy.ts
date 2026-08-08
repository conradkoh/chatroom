const BLOCKED_SEGMENT_NAMES = new Set(['.git', 'secrets', '.aws']);

function normalizeSegments(relativePath: string): { lowerSegments: string[]; basename: string } {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  return { lowerSegments, basename: lowerSegments.at(-1) ?? '' };
}

function hasBlockedSegment(lowerSegments: string[]): boolean {
  return lowerSegments.some((segment) => BLOCKED_SEGMENT_NAMES.has(segment));
}

function hasBlockedBasename(basename: string): boolean {
  return (
    /^\.env(?:\.|$)/.test(basename) ||
    /\.(?:pem|key)$/.test(basename) ||
    basename === 'id_rsa' ||
    basename === 'credentials.json'
  );
}

/** Returns true when a relative workspace path must not receive uploads. */
function isBlockedUploadTargetPath(relativePath: string): boolean {
  if (!relativePath) return false;
  const { lowerSegments, basename } = normalizeSegments(relativePath);
  return hasBlockedSegment(lowerSegments) || hasBlockedBasename(basename);
}

/** User-facing reason when an upload target path is blocked, or null if allowed. */
export function getBlockedUploadTargetReason(relativePath: string): string | null {
  if (!isBlockedUploadTargetPath(relativePath)) return null;
  return 'Cannot upload to this location (.git and sensitive paths are blocked)';
}
