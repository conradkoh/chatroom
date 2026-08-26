'use client';

import { Check, Copy } from 'lucide-react';
import React, { createContext, useContext, useState, useCallback, lazy, Suspense } from 'react';

import { useWorkspaceFileLink } from '../context/WorkspaceFileLinkContext';
import {
  detailModalFencedCodeBlockClassNames,
  detailModalFencedCodePreClassNames,
  detailModalInlineCodeClassNames,
  detailModalParagraphClassNames,
  detailModalProseClassNames,
  detailModalSpacerParagraphClassNames,
} from './detail-modal/detailModalMarkdownStyles';
import {
  markdownSurfaceBaseProseClassNames,
  markdownSurfaceFeedProseClassNames,
  markdownSurfaceInlineEventProseClassNames,
  markdownSurfaceTaskOverlayProseClassNames,
} from './markdown-surface';
import { fenceLangToSyntheticPath } from '../workspace/file-renderers/language-detection';
import { SyntaxHighlighter } from '../workspace/file-renderers/SyntaxHighlighter';
import { parseFileLocation } from '../workspace/utils/fileLocation';
import { isWorkspaceFileLink, looksLikeWorkspacePath } from '../workspace/utils/workspaceFileLink';

import { isEmptyParagraphChildren } from '@/components/markdown-editor/utils/emptyParagraph';

export {
  detailModalMarkdownProseClassNames,
  detailModalRichTextEditorProseClassNames,
} from './detail-modal';

// Lazy load MermaidBlock to avoid bundling mermaid in the main chunk
const MermaidBlock = lazy(() =>
  import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock }))
);

// ============================================================================
// Prose className Constants
// ============================================================================

/**
 * Shared interactive link styling for markdown HTTP links and workspace file buttons.
 * Applied at the component layer — not via prose-a modifiers — so hover targets the link itself.
 */
export const markdownLinkClassNames =
  'text-chatroom-status-info no-underline hover:text-chatroom-accent transition-colors';

/**
 * Tailwind Typography decorates inline `code` with `::before`/`::after` backticks.
 * Those glyphs are not part of the DOM text, so selection/copy omits them — disable here.
 */
/**
 * Full rich content prose styling (tables, blockquotes, links).
 * Used in: PromptModal.
 *
 * Features:
 * - Dark mode support
 * - Styled tables with borders
 * - Link colors (info/accent on hover)
 * - Styled blockquotes
 */
export const proseClassNames = markdownSurfaceBaseProseClassNames;

/**
 * Chip/review prose styling — alias of detail modal base prose.
 * Used in: AttachedBacklogItemChip, AttachedTaskChip, ReviewPanel.
 */
export const backlogProseClassNames = detailModalProseClassNames;

/**
 * Task detail prose styling (success-colored inline code).
 * Used in: TaskDetailModal, AttachedTaskChip modal.
 *
 * Features:
 * - Success-colored inline code
 * - Styled pre blocks with borders
 * - Link colors (info/accent on hover)
 *
 * Note: Layout classes like `h-full overflow-y-auto p-4 text-sm` should be added in the component.
 */
export const taskDetailProseClassNames = markdownSurfaceTaskOverlayProseClassNames;

/**
 * Message feed prose styling (compact, table scrolling).
 * Used in: MessageFeed.
 *
 * Features:
 * - Compact 13px text
 * - Link colors via markdownLinkClassNames (no underline)
 * - Scrollable tables
 */
export const messageFeedProseClassNames = markdownSurfaceFeedProseClassNames;

export const inlineEventProseClassNames = markdownSurfaceInlineEventProseClassNames;

// ============================================================================
// Markdown Components
// ============================================================================

const InsideMarkdownWorkspaceLinkContext = createContext(false);

/** Marks descendants so inline code does not render another workspace link button. */
export function MarkdownWorkspaceLinkScope({ children }: { children: React.ReactNode }) {
  return (
    <InsideMarkdownWorkspaceLinkContext.Provider value={true}>
      {children}
    </InsideMarkdownWorkspaceLinkContext.Provider>
  );
}

function useInsideMarkdownWorkspaceLink(): boolean {
  return useContext(InsideMarkdownWorkspaceLinkContext);
}

/**
 * Opens workspace file paths in the explorer when a provider is present.
 */
function WorkspaceFileLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  const { onOpenFile } = useWorkspaceFileLink();
  if (!onOpenFile) {
    return <span>{children}</span>;
  }
  return (
    <MarkdownWorkspaceLinkScope>
      <button
        type="button"
        className={`${markdownLinkClassNames} cursor-pointer bg-transparent border-0 p-0 text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-left`}
        onClick={() => {
          const location = parseFileLocation(href);
          if (location) onOpenFile(location);
        }}
      >
        {children}
      </button>
    </MarkdownWorkspaceLinkScope>
  );
}

/**
 * Shared link component: workspace file paths open in explorer; external links open in a new tab.
 */
function MarkdownLink({ children, href }: { children?: React.ReactNode; href?: string }) {
  if (href && isWorkspaceFileLink(href)) {
    return <WorkspaceFileLinkButton href={href}>{children}</WorkspaceFileLinkButton>;
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={markdownLinkClassNames}>
      {children}
    </a>
  );
}

function PlainInlineCode({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (className?.startsWith('language-')) {
    return <code className={className}>{children}</code>;
  }
  return <code className={detailModalInlineCodeClassNames}>{children}</code>;
}

function PlainMarkdownLink({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

function InlineCodeOrWorkspaceLink({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const insideWorkspaceLink = useInsideMarkdownWorkspaceLink();
  if (className?.startsWith('language-')) {
    return <code className={className}>{children}</code>;
  }
  const text = typeof children === 'string' ? children : null;
  if (text && looksLikeWorkspacePath(text) && !insideWorkspaceLink) {
    return <WorkspaceFileLinkButton href={text}>{text}</WorkspaceFileLinkButton>;
  }
  return <PlainInlineCode className={className}>{children}</PlainInlineCode>;
}

/**
 * Simplified markdown components for compact display.
 * Renders h1-h6 as bold inline text, strips most formatting.
 * Use with react-markdown's `components` prop.
 */
export const compactMarkdownComponents = {
  // Headers: render as bold inline text (no size change)
  h1: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  // Paragraphs: render inline
  p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  // Lists: render inline
  ul: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ol: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  li: ({ children }: { children?: React.ReactNode }) => <span>• {children} </span>,
  // Code: inline workspace paths linkify; otherwise simple styling
  code: InlineCodeOrWorkspaceLink,
  // Pre: render inline
  pre: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  // Keep emphasis
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  // Links: workspace paths open in explorer; external links open in new tab
  a: MarkdownLink,
};

/**
 * Extract text content from React children (handles nested code elements)
 */
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('');
  }
  if (React.isValidElement(children)) {
    // Handle code element inside pre
    const props = children.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}

/**
 * CodeBlock component with copy button for fenced code blocks.
 * Shows language badge and copy functionality.
 */
export function CodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g., "language-typescript" -> "typescript")
  const language = className?.replace('language-', '') || '';

  // Extract text content for copying
  const textContent = extractTextContent(children);

  // Map fence language to synthetic path for Shiki highlighting
  const syntheticPath = language ? fenceLangToSyntheticPath(language) : null;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [textContent]);

  return (
    <div className={detailModalFencedCodeBlockClassNames}>
      {/* Header bar */}
      <div className="flex items-center justify-between bg-chatroom-bg-secondary border-2 border-b-0 border-chatroom-border px-4 py-2">
        <span className="text-[10px] font-bold tracking-wide text-chatroom-text-muted">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 text-[10px] font-bold tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-opacity opacity-80 hover:opacity-100"
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check size={12} className="text-chatroom-status-success" />
              <span className="text-chatroom-status-success font-mono">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code content */}
      {syntheticPath ? (
        <div className="bg-chatroom-bg-secondary border-2 border-chatroom-border p-4 overflow-x-auto">
          <SyntaxHighlighter code={textContent} path={syntheticPath} className="text-xs" />
        </div>
      ) : (
        <pre className={detailModalFencedCodePreClassNames}>
          <code className={className || ''}>{children}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * Base markdown components with just the link override.
 * Use this for Markdown instances that don't need compact or full styling
 * but still need links to open in a new window.
 */
export const baseMarkdownComponents = {
  a: MarkdownLink,
};

/**
 * Full markdown components with enhanced code block rendering.
 * Includes copy button for fenced code blocks.
 * Use with react-markdown's `components` prop.
 */
export const fullMarkdownComponents = {
  // Links: always open in new window
  a: MarkdownLink,
  // Wrap pre elements with CodeBlock for copy functionality, or MermaidBlock for diagrams
  pre: ({ children }: { children?: React.ReactNode }) => {
    // The children of pre is usually a code element
    if (React.isValidElement(children)) {
      const codeProps = children.props as { children?: React.ReactNode; className?: string };
      // Mermaid diagram rendering
      if (codeProps.className === 'language-mermaid') {
        const chart = extractTextContent(codeProps.children);
        return (
          <Suspense
            fallback={
              <div className="my-3 flex justify-center p-4 bg-chatroom-bg-tertiary border-2 border-chatroom-border">
                <span className="text-xs text-chatroom-text-muted">Loading diagram...</span>
              </div>
            }
          >
            <MermaidBlock chart={chart} />
          </Suspense>
        );
      }
      return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
    }
    // Fallback for non-code pre content
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
        {children}
      </pre>
    );
  },
  // Inline code (not in pre) - workspace paths linkify; otherwise simple styling
  code: InlineCodeOrWorkspaceLink,
};

/**
 * Modal markdown components — like fullMarkdownComponents but wraps long lines
 * instead of overflow-x scroll for code blocks. Used in modal previews where
 * horizontal scroll is undesirable (AttachmentMarkdownModal, TaskDetailModal,
 * BacklogItemDetailModal).
 */
export const modalMarkdownComponents = {
  a: MarkdownLink,
  p: ({ children }: { children?: React.ReactNode }) =>
    isEmptyParagraphChildren(children) ? (
      <p className={detailModalSpacerParagraphClassNames} aria-hidden="true">
        {'\u00A0'}
      </p>
    ) : (
      <p className={detailModalParagraphClassNames}>{children}</p>
    ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <InlineCodeOrWorkspaceLink className={className} children={children} />
  ),
  pre: ({ children }: { children?: React.ReactNode }) => {
    if (React.isValidElement(children)) {
      const codeProps = children.props as { children?: React.ReactNode; className?: string };
      if (codeProps.className === 'language-mermaid') {
        const chart = extractTextContent(codeProps.children);
        return (
          <Suspense
            fallback={
              <div className="my-3 flex justify-center p-4 bg-chatroom-bg-tertiary border-2 border-chatroom-border">
                <span className="text-xs text-chatroom-text-muted">Loading diagram...</span>
              </div>
            }
          >
            <MermaidBlock chart={chart} />
          </Suspense>
        );
      }
      return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
    }
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-x-hidden text-sm text-chatroom-text-primary">
        {children}
      </pre>
    );
  },
};

/**
 * Backlog review markdown: no clickable file/URL links (plain text only).
 * Used in review panel and compact backlog queue previews — not chat history or detail modals.
 */
export const backlogReviewCompactMarkdownComponents = {
  ...compactMarkdownComponents,
  a: PlainMarkdownLink,
  code: PlainInlineCode,
};

export const backlogReviewMarkdownComponents = {
  ...baseMarkdownComponents,
  a: PlainMarkdownLink,
  code: PlainInlineCode,
};
