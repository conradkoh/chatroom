/**
 * File attachment registry — the single source of truth for attachment limits,
 * allowlisted MIME types, extension mapping, and preview behaviour.
 *
 * This module is a dependency leaf: it has no Zod or Convex imports so the CLI,
 * the backend, and the webapp can all consume it. Backend adapters derive their
 * validators from these exports; nothing downstream should duplicate the rules.
 *
 * @see docs/conventions/domain-models.md
 */

/** Maximum size of a single attachment blob (10 MiB). */
export const FILE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Maximum number of files attached to one handoff. */
export const FILE_ATTACHMENT_MAX_PER_HANDOFF = 10;

/** Maximum length of an attachment basename, in characters. */
export const FILE_ATTACHMENT_MAX_FILENAME_LENGTH = 255;

/** Upload endpoint used by the CLI to stream attachment bytes. */
export const FILE_ATTACHMENT_UPLOAD_PATH = '/chatroom/file-attachments/upload';

/** Thumbnails at or below this size are fetched automatically in the timeline (2 MiB). */
export const FILE_ATTACHMENT_THUMBNAIL_AUTOLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** How the timeline renders a stored attachment. */
export type FilePreviewKind = 'image' | 'markdown' | 'text' | 'pdf' | 'download';

interface FileAttachmentTypeInfo {
  readonly extensions: readonly string[];
  readonly previewKind: FilePreviewKind;
  /** True when the type can execute script in a browser context (SVG, HTML). */
  readonly activeContent: boolean;
}

const FILE_ATTACHMENT_TYPES = {
  'image/png': { extensions: ['.png'], previewKind: 'image', activeContent: false },
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], previewKind: 'image', activeContent: false },
  'image/gif': { extensions: ['.gif'], previewKind: 'image', activeContent: false },
  'image/webp': { extensions: ['.webp'], previewKind: 'image', activeContent: false },
  'image/svg+xml': { extensions: ['.svg'], previewKind: 'image', activeContent: true },
  'application/pdf': { extensions: ['.pdf'], previewKind: 'pdf', activeContent: false },
  'text/plain': { extensions: ['.txt', '.log'], previewKind: 'text', activeContent: false },
  'text/markdown': { extensions: ['.md'], previewKind: 'markdown', activeContent: false },
  'text/csv': { extensions: ['.csv'], previewKind: 'text', activeContent: false },
  'application/json': { extensions: ['.json'], previewKind: 'text', activeContent: false },
  'text/html': { extensions: ['.html', '.htm'], previewKind: 'text', activeContent: true },
  'application/zip': { extensions: ['.zip'], previewKind: 'download', activeContent: false },
} as const satisfies Record<string, FileAttachmentTypeInfo>;

/** Allowlisted MIME types for uploaded attachments. */
export type FileAttachmentMimeType = keyof typeof FILE_ATTACHMENT_TYPES;

/** Allowlisted MIME types in registry order. */
export const FILE_ATTACHMENT_MIME_TYPES = Object.keys(
  FILE_ATTACHMENT_TYPES
) as FileAttachmentMimeType[];

/** Lowercased extension → MIME type, derived once from the registry. */
const EXTENSION_TO_MIME_TYPE = new Map<string, FileAttachmentMimeType>(
  Object.entries(FILE_ATTACHMENT_TYPES).flatMap(([mimeType, info]) =>
    info.extensions.map((extension) => [
      extension.toLowerCase(),
      mimeType as FileAttachmentMimeType,
    ])
  )
);

/** Control characters (including NUL), DEL, and path separators. */
const INVALID_FILENAME_CHARACTER_PATTERN = /[/\\\u0000-\u001f\u007f]/;
const PATH_SEPARATOR_PATTERN = /[/\\]/;
const RESERVED_FILENAME_PATTERN = /^\.{1,2}$/;

function basenameOf(path: string): string {
  return path.split(PATH_SEPARATOR_PATTERN).pop() ?? '';
}

/** Looks up registry metadata for an exact MIME type; null when not allowlisted. */
function lookupByMimeType(mimeType: string): FileAttachmentTypeInfo | null {
  return Object.hasOwn(FILE_ATTACHMENT_TYPES, mimeType)
    ? FILE_ATTACHMENT_TYPES[mimeType as FileAttachmentMimeType]
    : null;
}

/**
 * Resolves an allowlisted type from a filename. Only the basename is considered;
 * the extension comparison is case-insensitive. Returns null for no extension or
 * for an extension that is not allowlisted.
 */
export function resolveFileAttachmentType(filename: string): {
  mimeType: FileAttachmentMimeType;
  previewKind: FilePreviewKind;
  activeContent: boolean;
} | null {
  const basename = basenameOf(filename);
  const dotIndex = basename.lastIndexOf('.');
  // `dotIndex <= 0` covers "README" (no extension) and dotfiles like ".env".
  if (dotIndex <= 0) return null;

  const mimeType = EXTENSION_TO_MIME_TYPE.get(basename.slice(dotIndex).toLowerCase());
  if (!mimeType) return null;

  const info = FILE_ATTACHMENT_TYPES[mimeType];
  return { mimeType, previewKind: info.previewKind, activeContent: info.activeContent };
}

/** Preview kind for a stored MIME type; unknown types fall back to 'download'. */
export function getFilePreviewKind(mimeType: string): FilePreviewKind {
  return lookupByMimeType(mimeType)?.previewKind ?? 'download';
}

/**
 * Content type used when storing the blob. Active content (SVG, HTML) is stored
 * as opaque bytes so it can never be served as an executable document.
 */
export function getStoredBlobContentType(mimeType: FileAttachmentMimeType): string {
  return FILE_ATTACHMENT_TYPES[mimeType].activeContent ? 'application/octet-stream' : mimeType;
}

/**
 * Validates a basename: non-empty, at most FILE_ATTACHMENT_MAX_FILENAME_LENGTH
 * characters, no path separators or control characters, and not '.' or '..'.
 */
export function isValidAttachmentFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= FILE_ATTACHMENT_MAX_FILENAME_LENGTH &&
    !RESERVED_FILENAME_PATTERN.test(filename) &&
    !INVALID_FILENAME_CHARACTER_PATTERN.test(filename)
  );
}
