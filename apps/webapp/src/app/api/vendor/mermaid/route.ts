import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

const MERMAID_MIN_PATH = path.join(process.cwd(), 'node_modules/mermaid/dist/mermaid.min.js');

export async function GET(): Promise<NextResponse> {
  const body = await readFile(MERMAID_MIN_PATH);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
