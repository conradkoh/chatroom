const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const DOCUMENT_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
};

function isPlaceholderName(name: string): boolean {
  return name === '' || name === 'image.png' || name === 'blob';
}

export function clipboardImageExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'png';
}

export function nameClipboardImageFile(file: File, index: number): File {
  if (!isPlaceholderName(file.name)) return file;
  const ext = clipboardImageExtension(file.type || 'image/png');
  const baseName = index === 0 ? `pasted-image.${ext}` : `pasted-image-${index + 1}.${ext}`;
  return new File([file], baseName, { type: file.type || 'image/png' });
}

/** Names a pasted file for upload. Empty or image MIME types use the image naming. */
export function nameClipboardFile(file: File, index: number): File {
  if (file.type === '' || file.type.startsWith('image/')) {
    return nameClipboardImageFile(file, index);
  }
  if (!isPlaceholderName(file.name)) return file;
  const ext = DOCUMENT_MIME_TO_EXT[file.type];
  const suffix = index === 0 ? '' : `-${index + 1}`;
  const baseName = ext ? `pasted-file${suffix}.${ext}` : `pasted-file${suffix}`;
  return new File([file], baseName, { type: file.type });
}

/** Every file in the paste payload, deduplicated and named. Used by the composer paste path. */
export function getFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  return collectClipboardFiles(clipboardData).map(nameClipboardFile);
}

/**
 * Image-only subset: `image/*` MIME types, empty MIME excluded.
 * Used by the sketch paste hook. Behavior is unchanged except that it now shares
 * the same collection (files fallback, dedupe).
 */
export function getImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  return collectClipboardFiles(clipboardData)
    .filter((file) => file.type.startsWith('image/'))
    .map(nameClipboardImageFile);
}

function collectClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const candidates: File[] = [];
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) candidates.push(file);
  }
  candidates.push(...Array.from(clipboardData.files ?? []));
  const seen = new Set<string>();
  return candidates.filter((file) => {
    const key = `${file.name}|${file.size}|${file.type}|${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
