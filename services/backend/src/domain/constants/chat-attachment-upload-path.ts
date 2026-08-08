// fallow-ignore-file complexity
// fallow-ignore-next-line unused-export
export const CHAT_ATTACHMENT_UPLOAD_DIR = '.chatroom/downloads/attachments/files';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Max UTF-8 bytes for the final filename component (uuid + '_' + basename). */
// fallow-ignore-next-line unused-export
export const CHAT_ATTACHMENT_FILENAME_MAX_BYTES = 255;

/** Reference-safe basename: [A-Za-z0-9._-], no quotes/slashes/controls, not dot-only. */
// fallow-ignore-next-line unused-export
export function sanitizeChatAttachmentFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\0-\x1f\x7f"<>\|:*?]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const valid = cleaned.length > 0 && cleaned !== '.' && cleaned !== '..';
  return valid ? cleaned.slice(0, 120) : 'attachment';
}

export function buildChatAttachmentUploadPath(originalFileName: string, uniqueId: string): string {
  const safeName = sanitizeChatAttachmentFileName(originalFileName);
  const fileName = `${uniqueId}_${safeName}`;
  const bytes = new TextEncoder().encode(fileName).length;
  if (bytes > CHAT_ATTACHMENT_FILENAME_MAX_BYTES) {
    throw new Error('Attachment filename too long');
  }
  if (!UUID_V4_RE.test(uniqueId)) {
    throw new Error('Invalid attachment id');
  }
  return `${CHAT_ATTACHMENT_UPLOAD_DIR}/${fileName}`;
}

function getAttachmentRemainder(normalized: string): string | null {
  if (!normalized.startsWith(`${CHAT_ATTACHMENT_UPLOAD_DIR}/`)) return null;
  const remainder = normalized.slice(CHAT_ATTACHMENT_UPLOAD_DIR.length + 1);
  if (!remainder || remainder.includes('/')) return null;
  return remainder;
}

function parseAttachmentFileName(remainder: string): boolean {
  const underscore = remainder.indexOf('_');
  if (underscore <= 0) return false;
  const uuid = remainder.slice(0, underscore);
  const basename = remainder.slice(underscore + 1);
  if (!UUID_V4_RE.test(uuid) || !basename) return false;
  return sanitizeChatAttachmentFileName(basename) === basename;
}

export function getInvalidChatAttachmentUploadPathReason(relativePath: string): string | null {
  if (relativePath.includes('\\')) return 'Invalid attachment path';
  const normalized = relativePath.replace(/\\/g, '/');
  const remainder = getAttachmentRemainder(normalized);
  if (!remainder || !parseAttachmentFileName(remainder)) {
    return 'Invalid attachment path';
  }
  if (new TextEncoder().encode(remainder).length > CHAT_ATTACHMENT_FILENAME_MAX_BYTES) {
    return 'Invalid attachment path';
  }
  return null;
}
