import { readFile } from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { resolveMermaidMinPath } from '@/modules/chatroom/lib/mermaid/resolveMermaidMinPath';

export async function GET(): Promise<NextResponse> {
  const body = await readFile(resolveMermaidMinPath());
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
