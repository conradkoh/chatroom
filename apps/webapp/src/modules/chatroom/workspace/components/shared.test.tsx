import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GitDiffStatClickable, InlineDiffStat } from './shared';

describe('InlineDiffStat', () => {
  it('shows Clean when tree is clean and in sync with remote', () => {
    render(
      <InlineDiffStat
        diffStat={{ filesChanged: 0, insertions: 0, deletions: 0 }}
        commitsAhead={0}
        commitsBehind={0}
      />
    );
    expect(screen.getByText('Clean')).toBeInTheDocument();
  });

  it('shows ahead/behind badges when clean but out of sync', () => {
    render(
      <InlineDiffStat
        diffStat={{ filesChanged: 0, insertions: 0, deletions: 0 }}
        commitsAhead={2}
        commitsBehind={1}
      />
    );
    expect(screen.getByText('↑2')).toBeInTheDocument();
    expect(screen.getByText('↓1')).toBeInTheDocument();
    expect(screen.queryByText('Clean')).not.toBeInTheDocument();
  });

  it('calls onSync when Sync is clicked', async () => {
    const user = userEvent.setup();
    const onSync = vi.fn();
    render(
      <InlineDiffStat
        diffStat={{ filesChanged: 0, insertions: 0, deletions: 0 }}
        commitsAhead={1}
        commitsBehind={0}
        syncEnabled
        onSync={onSync}
      />
    );
    await user.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledOnce();
  });
});

describe('GitDiffStatClickable', () => {
  const cleanOutOfSync = {
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    commitsAhead: 2,
    commitsBehind: 0,
  };

  it('does not nest buttons when local and out of sync', () => {
    render(
      <GitDiffStatClickable
        {...cleanOutOfSync}
        isLocal
        isSyncing={false}
        onSync={vi.fn()}
        onOpenGitPanel={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.querySelector('button')).toBeNull();
    }
  });

  it('calls onSync without opening git panel when Sync is clicked', async () => {
    const user = userEvent.setup();
    const onSync = vi.fn();
    const onOpenGitPanel = vi.fn();

    render(
      <GitDiffStatClickable
        {...cleanOutOfSync}
        isLocal
        isSyncing={false}
        onSync={onSync}
        onOpenGitPanel={onOpenGitPanel}
      />
    );

    await user.click(screen.getByRole('button', { name: /sync/i }));
    expect(onSync).toHaveBeenCalledOnce();
    expect(onOpenGitPanel).not.toHaveBeenCalled();
  });

  it('opens git panel when the status area is clicked', async () => {
    const user = userEvent.setup();
    const onOpenGitPanel = vi.fn();

    render(
      <GitDiffStatClickable
        {...cleanOutOfSync}
        isLocal
        isSyncing={false}
        onSync={vi.fn()}
        onOpenGitPanel={onOpenGitPanel}
      />
    );

    const [statusButton] = screen.getAllByRole('button');
    await user.click(statusButton);
    expect(onOpenGitPanel).toHaveBeenCalledOnce();
  });
});
