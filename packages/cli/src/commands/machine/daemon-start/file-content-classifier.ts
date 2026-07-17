export type FileContentClassification =
  { kind: 'text'; encoding: 'utf8' } | { kind: 'binary'; encoding: 'binary' };

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
]);

export const BINARY_FILE_EXTENSIONS: ReadonlySet<string> = BINARY_EXTENSIONS;

export function extensionOf(path: string): string | null {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return null;
  return path.slice(lastDot).toLowerCase();
}

export function hasKnownBinaryExtension(path: string): boolean {
  const ext = extensionOf(path);
  return ext !== null && BINARY_EXTENSIONS.has(ext);
}

function hasNulByte(buffer: Uint8Array): boolean {
  return buffer.includes(0);
}

function hasTooManyControlChars(buffer: Uint8Array): boolean {
  let count = 0;
  const threshold = Math.max(1, Math.floor(buffer.length * 0.01));
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      count++;
      if (count > threshold) return true;
    }
  }
  return false;
}

export function classifyFileContent(path: string, buffer: Uint8Array): FileContentClassification {
  if (hasKnownBinaryExtension(path)) {
    return { kind: 'binary', encoding: 'binary' };
  }

  if (buffer.length === 0) {
    return { kind: 'text', encoding: 'utf8' };
  }

  if (hasNulByte(buffer)) {
    return { kind: 'binary', encoding: 'binary' };
  }

  // Try decoding as UTF-8
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (decoded.length === 0) {
      return { kind: 'text', encoding: 'utf8' };
    }
    if (hasTooManyControlChars(buffer)) {
      return { kind: 'binary', encoding: 'binary' };
    }
    return { kind: 'text', encoding: 'utf8' };
  } catch {
    return { kind: 'binary', encoding: 'binary' };
  }
}
