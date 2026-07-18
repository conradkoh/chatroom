import React from 'react';

import { looksLikeWorkspacePath } from '../../workspace/utils/workspaceFileLink';

const markdownLinkClassNames = 'text-chatroom-status-info no-underline';

function ExportInlineCode({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (className?.startsWith('language-')) {
    return <code className={className}>{children}</code>;
  }
  return (
    <code className="bg-chatroom-bg-tertiary px-1.5 py-0.5 text-chatroom-status-success text-[0.9em] break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

function ExportCodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const language = className?.replace('language-', '') || 'code';
  return (
    <div className="relative not-prose mb-3">
      <div className="flex items-center justify-between bg-chatroom-bg-secondary border-2 border-b-0 border-chatroom-border px-4 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          {language}
        </span>
      </div>
      <pre className="bg-chatroom-bg-secondary border-2 border-chatroom-border p-4 overflow-x-auto">
        <code className={`${className || ''} text-xs text-chatroom-text-primary font-mono`}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function extractTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractTextContent).join('');
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}

export const exportMarkdownComponents = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} className={markdownLinkClassNames}>
      {children}
    </a>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const text = typeof children === 'string' ? children : null;
    if (text && looksLikeWorkspacePath(text)) {
      return (
        <code className="text-chatroom-status-info break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          {children}
        </code>
      );
    }
    return <ExportInlineCode className={className}>{children}</ExportInlineCode>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => {
    if (React.isValidElement(children)) {
      const codeProps = children.props as { children?: React.ReactNode; className?: string };
      if (codeProps.className === 'language-mermaid') {
        return (
          <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
            <code>{extractTextContent(codeProps.children)}</code>
          </pre>
        );
      }
      return (
        <ExportCodeBlock className={codeProps.className}>{codeProps.children}</ExportCodeBlock>
      );
    }
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
        {children}
      </pre>
    );
  },
};
