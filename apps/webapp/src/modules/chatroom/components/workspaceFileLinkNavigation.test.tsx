import { fireEvent, render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import { describe, expect, it, vi } from 'vitest';

import { chatroomRemarkPlugins } from './chatroomRemarkPlugins';
import { fullMarkdownComponents } from './markdown-utils';
import { WorkspaceFileLinkProvider } from '../context/WorkspaceFileLinkContext';

describe('workspace file link navigation', () => {
  it('passes FileLocation with line numbers when a citation link is clicked', () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceFileLinkProvider onOpenFile={onOpenFile}>
        <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
          {'See apps/webapp/src/foo.ts:42-48 for auth'}
        </Markdown>
      </WorkspaceFileLinkProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'apps/webapp/src/foo.ts:42-48' }));

    expect(onOpenFile).toHaveBeenCalledWith({
      filePath: 'apps/webapp/src/foo.ts',
      startLine: 42,
      endLine: 48,
    });
  });

  it('passes path-only FileLocation for plain workspace paths', () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceFileLinkProvider onOpenFile={onOpenFile}>
        <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
          {'Open apps/webapp/src/foo.ts now'}
        </Markdown>
      </WorkspaceFileLinkProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'apps/webapp/src/foo.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith({
      filePath: 'apps/webapp/src/foo.ts',
    });
  });

  it('passes FileLocation when inline code contains a line citation', () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceFileLinkProvider onOpenFile={onOpenFile}>
        <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
          {'Check `apps/webapp/src/foo.ts:99`'}
        </Markdown>
      </WorkspaceFileLinkProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'apps/webapp/src/foo.ts:99' }));

    expect(onOpenFile).toHaveBeenCalledWith({
      filePath: 'apps/webapp/src/foo.ts',
      startLine: 99,
      endLine: 99,
    });
  });
});
