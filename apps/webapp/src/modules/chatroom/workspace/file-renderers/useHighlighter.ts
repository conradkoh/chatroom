import { useCallback, useEffect, useRef, useState } from 'react';
import { createHighlighter, type Highlighter } from 'shiki';

import { detectLanguage, MAX_FILE_SIZE } from './language-detection';

type HighlighterStatus = 'idle' | 'loading' | 'ready' | 'error';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: ['ts', 'tsx', 'js', 'jsx', 'json', 'md'],
    });
  }
  return highlighterPromise;
}

interface UseHighlighterResult {
  status: HighlighterStatus;
  highlight: (code: string, path: string) => Promise<string>;
}

export function useHighlighter(): UseHighlighterResult {
  const [status, setStatus] = useState<HighlighterStatus>('idle');
  const hlRef = useRef<Highlighter | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current || hlRef.current) return;
    loadingRef.current = true;
    setStatus('loading');
    getHighlighter()
      .then((hl) => {
        hlRef.current = hl;
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
  }, []);

  const highlight = useCallback(async (code: string, path: string): Promise<string> => {
    if (code.length > MAX_FILE_SIZE) {
      return escapeHtml(code);
    }

    const detected = detectLanguage(path);
    if (!detected) {
      return escapeHtml(code);
    }

    let hl = hlRef.current;
    if (!hl) {
      hl = await getHighlighter();
      hlRef.current = hl;
    }

    if (!detected.isEager) {
      try {
        await hl.loadLanguage(detected.lang as Parameters<Highlighter['loadLanguage']>[0]);
      } catch {
        return escapeHtml(code);
      }
    }

    return hl.codeToHtml(code, {
      lang: detected.lang,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: 'light',
      transformers: [
        {
          name: 'remove-bg',
          pre(node) {
            if (typeof node.properties.style === 'string') {
              node.properties.style = node.properties.style
                .replace(/background-color\s*:\s*[^;]+;?/gi, '')
                .replace(/--shiki-dark-bg\s*:\s*[^;]+;?/gi, '')
                .trim();
              if (!node.properties.style) delete node.properties.style;
            }
          },
          code(node) {
            if (typeof node.properties.style === 'string') {
              node.properties.style = node.properties.style
                .replace(/background-color\s*:\s*[^;]+;?/gi, '')
                .trim();
              if (!node.properties.style) delete node.properties.style;
            }
          },
        },
      ],
    });
  }, []);

  return { status, highlight };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
