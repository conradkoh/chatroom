import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const MERMAID_MIN_PATH = require.resolve('mermaid/dist/mermaid.min.js');

export async function GET(): Promise<NextResponse> {
  const body = await readFile(MERMAID_MIN_PATH);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
