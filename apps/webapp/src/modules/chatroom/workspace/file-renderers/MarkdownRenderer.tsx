'use client';

import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';

import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import {
  fullMarkdownComponents,
  MarkdownWorkspaceLinkScope,
  markdownLinkClassNames,
  proseClassNames,
} from '../../components/markdown-utils';
import { useWorkspaceFileLink } from '../../context/WorkspaceFileLinkContext';
import { resolveFileLocationFromBase } from '../utils/fileLocation';
import { isWorkspaceFileLink } from '../utils/workspaceFileLink';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function BaseAwareMarkdownLink({
  href,
  children,
  baseFilePath,
}: {
  href?: string;
  children?: React.ReactNode;
  baseFilePath: string;
}) {
  const { onOpenFile } = useWorkspaceFileLink();
  if (!href || !isWorkspaceFileLink(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={markdownLinkClassNames}>
        {children}
      </a>
    );
  }
  if (!onOpenFile) {
    return <span>{children}</span>;
  }
  return (
    <MarkdownWorkspaceLinkScope>
      <button
        type="button"
        className={`${markdownLinkClassNames} cursor-pointer bg-transparent border-0 p-0 text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-left`}
        onClick={() => {
          const location = resolveFileLocationFromBase(baseFilePath, href);
          if (location) onOpenFile(location);
        }}
      >
        {children}
      </button>
    </MarkdownWorkspaceLinkScope>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const { baseFilePath } = useWorkspaceFileLink();
  const components = useMemo(() => {
    if (!baseFilePath) return fullMarkdownComponents;
    return {
      ...fullMarkdownComponents,
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <BaseAwareMarkdownLink href={href} baseFilePath={baseFilePath}>
          {children}
        </BaseAwareMarkdownLink>
      ),
    };
  }, [baseFilePath]);

  return (
    <div className={className ?? proseClassNames}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={components}>
        {content}
      </Markdown>
    </div>
  );
});
