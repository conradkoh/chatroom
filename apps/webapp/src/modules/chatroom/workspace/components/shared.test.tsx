import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InlineDiffStat } from './shared';

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
