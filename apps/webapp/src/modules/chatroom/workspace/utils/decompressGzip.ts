/**
 * Workspace data can be either a legacy plain base64 string or the current
 * compressed object format `{ compression: "gzip", content: string }`.
 * This helper extracts the base64 content regardless of shape.
 */
export function extractBase64Content(
  data: string | { compression: 'gzip'; content: string }
): string {
  if (typeof data === 'string') {
    return data;
  }
  return data.content;
}

/**
 * Decompress a base64-encoded gzip string using the browser's DecompressionStream API.
 */
export async function decompressGzip(base64Data: string): Promise<string> {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}
