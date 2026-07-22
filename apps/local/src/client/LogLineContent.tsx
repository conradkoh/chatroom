import type { ReactNode } from 'react';

import { parseLogTextSegments, splitUrls } from './log-text';

export function LogLineContent({ text }: { text: string }) {
  const segments = parseLogTextSegments(text);
  const nodes: ReactNode[] = [];
  let key = 0;

  for (const segment of segments) {
    const style = {
      color: segment.color,
      fontWeight: segment.bold ? 700 : undefined,
    } as const;

    for (const part of splitUrls(segment.text)) {
      if (part.type === 'url') {
        nodes.push(
          <a
            key={key++}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={style}
          >
            {part.value}
          </a>
        );
        continue;
      }

      if (!part.value) continue;
      nodes.push(
        <span key={key++} style={style}>
          {part.value}
        </span>
      );
    }
  }

  return <>{nodes}</>;
}
