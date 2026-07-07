'use client';

import { memo, useEffect, useState, useRef } from 'react';

import { detectLanguage, MAX_FILE_SIZE } from './language-detection';
import { useHighlighter } from './useHighlighter';

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
  const [html, setHtml] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const shouldHighlight =
    code.length <= MAX_FILE_SIZE && detectLanguage(path) !== null && status !== 'error';

  const wrapperClassName = [className, '[&_.shiki]:bg-transparent'].filter(Boolean).join(' ');

  useEffect(() => {
    if (!shouldHighlight) {
      setHtml(null);
      return;
    }

    if (status !== 'ready') return;

    const requestId = ++latestRequest.current;
    let cancelled = false;

    highlight(code, path).then((result) => {
      if (cancelled || requestId !== latestRequest.current) return;
      setHtml(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, path, status, shouldHighlight, highlight]);

  if (!shouldHighlight || html === null) {
    if (lineNumbers) {
      return <PlainTextWithLineNumbers code={code} className={wrapperClassName} />;
    }
    return (
      <pre className={wrapperClassName}>
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
        <div className={wrapperClassName} dangerouslySetInnerHTML={{ __html: html }} />
      </>
    );
  }

  return <div className={wrapperClassName} dangerouslySetInnerHTML={{ __html: html }} />;
});

function PlainTextWithLineNumbers({ code, className }: { code: string; className: string }) {
  return (
    <>
      <div className="sticky left-0 select-none border-r border-chatroom-border bg-chatroom-bg-primary py-4 pr-3 pl-2 text-right w-[3.5rem] shrink-0">
        {code.split('\n').map((_, i) => (
          <div key={i} className="text-[10px] font-mono text-chatroom-text-muted leading-relaxed">
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
