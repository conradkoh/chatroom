import { gunzipSync, gzipSync } from 'node:zlib';

export type EncodedOutput = string | { compression: 'gzip'; content: string };

export function encodeOutput(plain: string): { compression: 'gzip'; content: string } {
  const compressed = gzipSync(Buffer.from(plain, 'utf-8'));
  return {
    compression: 'gzip',
    content: compressed.toString('base64'),
  };
}

export function decodeOutput(value: EncodedOutput): string {
  if (typeof value === 'string') return value;
  const decoded = gunzipSync(Buffer.from(value.content, 'base64'));
  return decoded.toString('utf-8');
}
