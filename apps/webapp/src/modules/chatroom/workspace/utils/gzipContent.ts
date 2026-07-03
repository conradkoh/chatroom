/**
 * Browser-compatible gzip helpers for workspace file writes.
 */

/** Compress text to base64-encoded gzip (matches backend V2 content shape). */
export async function compressGzip(
  text: string
): Promise<{ compression: 'gzip'; content: string }> {
  const input = new TextEncoder().encode(text);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(compressed);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return { compression: 'gzip', content: btoa(binary) };
}

/** Validate a relative workspace file path for create/write. Returns error message or null. */
// fallow-ignore-next-line complexity
export function validateRelativeFilePath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) return 'Path is required';
  if (trimmed.length > 1024) return 'Path is too long';
  if (trimmed.startsWith('/')) return 'Absolute paths are not allowed';
  if (trimmed.includes('..')) return 'Path traversal is not allowed';
  if (trimmed.includes('\0')) return 'Invalid path';
  return null;
}

/** Ensure new file paths default to `.md` when no extension is provided. */
// fallow-ignore-next-line complexity
export function normalizeNewFilePath(input: string): string {
  const trimmed = input.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  const baseName = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
  const dirPrefix = lastSlash === -1 ? '' : trimmed.slice(0, lastSlash + 1);

  if (!baseName || baseName === '.') {
    return `${dirPrefix}untitled.md`;
  }

  const lastDot = baseName.lastIndexOf('.');
  if (lastDot <= 0) {
    return `${dirPrefix}${baseName}.md`;
  }

  return trimmed;
}
