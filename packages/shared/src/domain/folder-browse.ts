/** Cap on entries in one directory listing (backend-enforced). */
export const FOLDER_BROWSE_MAX_ENTRIES = 500;
/** Cap on one entry name, in characters (backend-enforced). */
export const FOLDER_BROWSE_MAX_NAME_LENGTH = 255;
/** Cap on the summed UTF-8 bytes of all entry names in one listing (backend-enforced). */
export const FOLDER_BROWSE_MAX_NAME_BYTES = 64 * 1024;
/** Cap on a browse path, in characters after trim. */
export const FOLDER_BROWSE_MAX_PATH_LENGTH = 1024;
/** Cap on the daemon-side directory-name filter. */
export const FOLDER_BROWSE_MAX_FILTER_LENGTH = 128;
/** Cap on a daemon error message stored on the session. */
export const FOLDER_BROWSE_MAX_ERROR_MESSAGE_LENGTH = 500;
/** Live sessions kept per user and machine; the oldest is evicted by `open`. */
export const FOLDER_BROWSE_MAX_ACTIVE_PER_MACHINE = 3;
/** Rows the daemon's pending-row subscription asks for. */
export const FOLDER_BROWSE_PENDING_LIMIT = 20;
/** How long a pending session may sit unanswered before the UI shows `no-response`. */
export const FOLDER_BROWSE_NO_RESPONSE_MS = 15_000;

export const FOLDER_BROWSE_ERROR_CODES = [
  'PERMISSION_DENIED',
  'READ_FAILED',
  'TIMEOUT',
  'UNSUPPORTED_PLATFORM',
] as const;
export type FolderBrowseErrorCode = (typeof FOLDER_BROWSE_ERROR_CODES)[number];

/** One browsable directory. Files are never listed. */
export interface FolderBrowseEntry {
  name: string;
  symlink?: true;
}

/** Thrown by `normalizeBrowsePath` for any input that is not a browsable absolute path. */
export class FolderBrowsePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderBrowsePathError';
  }
}

/** True when `value` contains a C0 control character (U+0000–U+001F) or DEL (U+007F). */
export function hasFolderBrowseControlCharacter(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}

/**
 * Normalizes a browsable absolute POSIX path.
 * Trim; require a leading '/'; at most FOLDER_BROWSE_MAX_PATH_LENGTH characters after trim;
 * reject any C0 control character or DEL; collapse repeated '/', drop '.' segments; reject any
 * '..' segment; strip a trailing '/' unless the path is root. '/' is valid.
 * Deliberately does NOT apply the working-dir shell blocklist, so names such as
 * 'My (old) #2' can still be browsed.
 * @throws FolderBrowsePathError
 */
// fallow-ignore-next-line complexity
export function normalizeBrowsePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new FolderBrowsePathError('Path is required');
  if (trimmed.length > FOLDER_BROWSE_MAX_PATH_LENGTH) {
    throw new FolderBrowsePathError(
      `Path is too long (max ${FOLDER_BROWSE_MAX_PATH_LENGTH} characters)`
    );
  }
  if (!trimmed.startsWith('/')) {
    throw new FolderBrowsePathError('Path must be absolute (start with /)');
  }
  if (hasFolderBrowseControlCharacter(trimmed)) {
    throw new FolderBrowsePathError('Path must not contain control characters');
  }

  const segments: string[] = [];
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw new FolderBrowsePathError('Path must not contain ".."');
    segments.push(segment);
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Sum of the UTF-8 byte length of every entry name. */
export function folderBrowseNameBytes(entries: readonly FolderBrowseEntry[]): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const entry of entries) total += encoder.encode(entry.name).length;
  return total;
}
