const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function clipboardImageExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'png';
}

export function nameClipboardImageFile(file: File, index: number): File {
  const ext = clipboardImageExtension(file.type || 'image/png');
  const baseName = index === 0 ? `pasted-image.${ext}` : `pasted-image-${index + 1}.${ext}`;
  if (file.name && file.name !== 'image.png' && file.name !== 'blob') return file;
  return new File([file], baseName, { type: file.type || 'image/png' });
}

export function getImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files.map(nameClipboardImageFile);
}
