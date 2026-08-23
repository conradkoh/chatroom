'use client';

import type { Mermaid } from 'mermaid';

// Pre-bundled build has no internal dynamic chunks, avoiding stale Turbopack HMR sub-chunks.
import 'mermaid/dist/mermaid.min.js';

declare global {
  interface MermaidGlobal {
    mermaid?: Mermaid;
  }
}

export function getMermaidInstance(): Mermaid {
  const instance = (globalThis as MermaidGlobal).mermaid;
  if (!instance) throw new Error('Mermaid failed to load');
  return instance;
}
