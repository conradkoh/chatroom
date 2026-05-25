import type { EncodedOutput } from './output-encoding';

export { type EncodedOutput } from './output-encoding';

/**
 * Browser-compatible gzip decompression using the native DecompressionStream API.
 * Must be awaited — DecompressionStream is inherently async.
 * Does NOT import Node zlib, safe for webapp bundling.
 */
export async function decodeOutputBrowser(value: EncodedOutput): Promise<string> {
  if (typeof value === 'string') return value;
  const binaryString = atob(value.content);
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
