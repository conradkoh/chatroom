'use client';

import type { Mermaid } from 'mermaid';

declare global {
  interface MermaidGlobal {
    mermaid?: Mermaid;
  }
}

let cachedInstance: Mermaid | null = null;
let loadPromise: Promise<Mermaid> | null = null;

/** Loads pre-bundled mermaid.min.js (no internal dynamic chunks — avoids Turbopack HMR stale sub-chunk warnings). */
export async function loadMermaidInstance(): Promise<Mermaid> {
  if (cachedInstance) return cachedInstance;
  if (!loadPromise) {
    loadPromise = import('mermaid/dist/mermaid.min.js').then(() => {
      const instance = (globalThis as MermaidGlobal).mermaid;
      if (!instance) throw new Error('Mermaid failed to load');
      cachedInstance = instance;
      return instance;
    });
  }
  return loadPromise;
}
