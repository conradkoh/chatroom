'use client';

import { memo, useEffect, useState, useRef } from 'react';
import { useTheme } from '@/modules/theme/ThemeProvider';
import { useHighlighter } from './useHighlighter';
import { detectLanguage, MAX_FILE_SIZE } from './language-detection';

interface SyntaxHighlighterProps {
  code: string;
  path: string;
  /** If true, renders line numbers alongside the code */
  lineNumbers?: boolean;
  className?: string;
}

export const SyntaxHighlighter = memo(function SyntaxHighlighter({
  code,
  path,
  lineNumbers = false,
  className = '',
}: SyntaxHighlighterProps) {
  const { status, highlight } = useHighlighter();
  const { theme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';

  const shouldHighlight =
    code.length <= MAX_FILE_SIZE && detectLanguage(path) !== null && status !== 'error';

  useEffect(() => {
    if (!shouldHighlight) {
      setHtml(null);
      return;
    }

    if (status !== 'ready') return;

    const requestId = ++latestRequest.current;
    let cancelled = false;

    highlight(code, path, resolvedTheme).then((result) => {
      if (cancelled || requestId !== latestRequest.current) return;
      setHtml(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, path, status, shouldHighlight, highlight, resolvedTheme]);

  if (!shouldHighlight || html === null) {
    if (lineNumbers) {
      return (
        <PlainTextWithLineNumbers code={code} className={className} />
      );
    }
    return (
      <pre className={className}>
        <code>{code}</code>
      </pre>
    );
  }

  if (lineNumbers) {
    const codeLines = code.split('\n');
    return (
      <>
        <div className="sticky left-0 select-none border-r border-chatroom-border bg-chatroom-bg-primary py-4 pr-3 pl-2 text-right w-[3.5rem] shrink-0">
          {codeLines.map((_, i) => (
            <div
              key={i}
              className="text-[10px] font-mono text-chatroom-text-muted leading-relaxed"
              style={{ lineHeight: '1.625' }}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <div
          className={className}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </>
    );
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

function PlainTextWithLineNumbers({
  code,
  className,
}: {
  code: string;
  className: string;
}) {
  return (
    <>
      <div className="sticky left-0 select-none border-r border-chatroom-border bg-chatroom-bg-primary py-4 pr-3 pl-2 text-right w-[3.5rem] shrink-0">
        {code.split('\n').map((_, i) => (
          <div
            key={i}
            className="text-[10px] font-mono text-chatroom-text-muted leading-relaxed"
          >
            {i + 1}
          </div>
        ))}
      </div>
      <pre className={className}>
        <code>{code}</code>
      </pre>
    </>
  );
}
