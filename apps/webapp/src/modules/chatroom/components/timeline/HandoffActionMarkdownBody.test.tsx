import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HandoffActionMarkdownBody } from './HandoffActionMarkdownBody';
import { WorkspaceFileLinkProvider } from '../../context/WorkspaceFileLinkContext';

const FILE_PATH = 'apps/webapp/src/modules/chatroom/utils/handoffSeverity.ts';

function renderWithFileLinks(content: string, onOpenFile = vi.fn()) {
  render(
    <WorkspaceFileLinkProvider onOpenFile={onOpenFile}>
      <HandoffActionMarkdownBody content={content} />
    </WorkspaceFileLinkProvider>
  );
  return onOpenFile;
}

describe('HandoffActionMarkdownBody', () => {
  it('renders clickable workspace file path after severity chip', () => {
    const onOpenFile = renderWithFileLinks(`## Tech Debt Observed
- [high] ${FILE_PATH} — missing validation`);

    fireEvent.click(screen.getByRole('button', { name: FILE_PATH }));

    expect(onOpenFile).toHaveBeenCalledWith({ filePath: FILE_PATH });
    expect(screen.getByTestId('severity-chip-high')).toBeInTheDocument();
  });

  it('renders clickable inline-code workspace path after severity chip', () => {
    const onOpenFile = renderWithFileLinks(`## Unresolved Decisions
- [medium] \`${FILE_PATH}\` — pick approach`);

    fireEvent.click(screen.getByRole('button', { name: FILE_PATH }));

    expect(onOpenFile).toHaveBeenCalledWith({ filePath: FILE_PATH });
    expect(screen.getByTestId('severity-chip-medium')).toBeInTheDocument();
  });

  it('renders clickable workspace path in non-severity action bullets', () => {
    const onOpenFile = renderWithFileLinks(`## Manual steps
- Open ${FILE_PATH} and verify`);

    fireEvent.click(screen.getByRole('button', { name: FILE_PATH }));

    expect(onOpenFile).toHaveBeenCalledWith({ filePath: FILE_PATH });
  });
});
