/**
 * AnsiText — renders a string that may contain ANSI escape sequences and URLs
 * as styled React nodes.
 *
 * - ANSI SGR codes (colors, bold, italic, underline, etc.) are converted to
 *   inline `style` props via the `anser` library.
 * - http(s):// and file:// URLs are wrapped in `<a target="_blank">` anchors.
 * - Returns a Fragment so it slots into any `<pre>` / `<div>` parent without
 *   breaking whitespace-pre-wrap handling.
 * - Pure component — no network calls, no hooks beyond useMemo.
 */

import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AnserJsonEntry } from 'anser';
// anser is a CJS module (module.exports = Anser). Use require so both webpack
// (Next.js) and Vite (Vitest) resolve the CJS export correctly without needing
// ESM interop gymnastics.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Anser = require('anser') as {
  ansiToJson(txt: string, options?: { use_classes?: boolean; remove_empty?: boolean }): AnserJsonEntry[];
};

// ─── URL linkification ────────────────────────────────────────────────────────

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+|\bfile:\/\/[^\s<>"'`]+/g;

function linkifyContent(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  // Reset stateful lastIndex before each call
  URL_REGEX.lastIndex = 0;
  let match;

  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    nodes.push(
      <a
        key={`url-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-blue-400 hover:text-blue-300"
      >
        {url}
      </a>
    );
    lastIndex = match.index + url.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

// ─── ANSI token → inline style ────────────────────────────────────────────────

function tokenToStyle(token: AnserJsonEntry): CSSProperties {
  const style: CSSProperties = {};

  if (token.fg) {
    style.color = `rgb(${token.fg})`;
  }
  if (token.bg) {
    style.backgroundColor = `rgb(${token.bg})`;
  }

  const decs = token.decorations;
  if (decs.includes('bold')) style.fontWeight = 'bold';
  if (decs.includes('dim')) style.opacity = 0.5;
  if (decs.includes('italic')) style.fontStyle = 'italic';

  const underline = decs.includes('underline');
  const strikethrough = decs.includes('strikethrough');
  if (underline && strikethrough) style.textDecoration = 'underline line-through';
  else if (underline) style.textDecoration = 'underline';
  else if (strikethrough) style.textDecoration = 'line-through';

  if (decs.includes('hidden')) style.visibility = 'hidden';

  return style;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AnsiTextProps {
  text: string;
}

export function AnsiText({ text }: AnsiTextProps) {
  const nodes = useMemo(() => {
    let tokens: AnserJsonEntry[];
    try {
      tokens = Anser.ansiToJson(text, { use_classes: false });
    } catch {
      // Fallback: render plain text if parsing fails (e.g. stray control chars)
      return [<span key="fallback">{text}</span>];
    }

    return tokens
      .filter((token) => token.content.length > 0)
      .map((token, i) => {
        const style = tokenToStyle(token);
        const content = linkifyContent(token.content);

        return (
          <span key={i} style={Object.keys(style).length > 0 ? style : undefined}>
            {content}
          </span>
        );
      });
  }, [text]);

  return <>{nodes}</>;
}
