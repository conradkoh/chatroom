'use client';

import type { Mermaid } from 'mermaid';
import mermaidScriptUrl from 'mermaid/dist/mermaid.min.js?url';

declare global {
  interface MermaidGlobal {
    mermaid?: Mermaid;
  }
}

const MERMAID_SCRIPT_SELECTOR = 'script[data-mermaid-loader]';

let cachedInstance: Mermaid | null = null;
let loadPromise: Promise<Mermaid> | null = null;

function loadMermaidScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Mermaid can only load in the browser'));
  }

  const existing = (globalThis as MermaidGlobal).mermaid;
  if (existing) return Promise.resolve();

  const existingScript = document.querySelector<HTMLScriptElement>(MERMAID_SCRIPT_SELECTOR);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Mermaid failed to load')), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = mermaidScriptUrl;
    script.async = true;
    script.dataset.mermaidLoader = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Mermaid failed to load'));
    document.head.appendChild(script);
  });
}

/** Loads pre-bundled mermaid.min.js (no internal dynamic chunks — avoids Turbopack HMR stale sub-chunk warnings). */
export async function loadMermaidInstance(): Promise<Mermaid> {
  if (cachedInstance) return cachedInstance;
  if (!loadPromise) {
    loadPromise = loadMermaidScript().then(() => {
      const instance = (globalThis as MermaidGlobal).mermaid;
      if (!instance) throw new Error('Mermaid failed to load');
      cachedInstance = instance;
      return instance;
    });
  }
  return loadPromise;
}
