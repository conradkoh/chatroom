import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EphemeralAgentGroup } from './EphemeralAgentGroup';

const COUNTS = { online: 1, offline: 6, errored: 1, total: 8 };

const MEMBERS = (
  <>
    <div>member-a</div>
    <div>member-b</div>
  </>
);

function renderGroup(props: Partial<React.ComponentProps<typeof EphemeralAgentGroup>> = {}): {
  onToggle: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn();
  render(
    <EphemeralAgentGroup
      total={8}
      counts={COUNTS}
      expanded={false}
      onToggle={onToggle}
      memberCount={2}
      {...props}
    >
      {MEMBERS}
    </EphemeralAgentGroup>
  );
  return { onToggle };
}

describe('EphemeralAgentGroup', () => {
  it('renders a collapsed disclosure with counts and hides the body', () => {
    renderGroup();

    const button = screen.getByRole('button', {
      name: 'Ephemeral agents: 1 online, 6 offline, 1 errored. Show group.',
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(screen.getByText('Ephemeral (8)')).toBeInTheDocument();
    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(screen.getByText('6 offline')).toBeInTheDocument();
    expect(screen.getByText('1 errored')).toBeInTheDocument();
    expect(screen.queryByTestId('ephemeral-agent-group-body')).not.toBeInTheDocument();
    expect(screen.queryByText('member-a')).not.toBeInTheDocument();
    expect(screen.queryByText('member-b')).not.toBeInTheDocument();
  });

  it('renders an expanded body linked from the toggle and rotates the chevron', () => {
    renderGroup({ expanded: true });

    const button = screen.getByRole('button');
    const body = screen.getByTestId('ephemeral-agent-group-body');

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', body.id);
    expect(button).toHaveAccessibleName(
      'Ephemeral agents: 1 online, 6 offline, 1 errored. Hide group.'
    );
    expect(screen.getByText('member-a')).toBeInTheDocument();
    expect(screen.getByText('member-b')).toBeInTheDocument();
    expect(button.querySelector('svg')).toHaveClass('rotate-90');
  });

  it('shows the loading line instead of counts while statuses load', () => {
    renderGroup({ counts: null });

    expect(screen.getByText('Loading statuses…')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ online$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ offline$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ errored$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Ephemeral agents: statuses loading. Show group.',
      })
    ).toBeInTheDocument();
  });

  it('renders zero counts when nothing is online or errored', () => {
    renderGroup({ counts: { online: 0, offline: 8, errored: 0, total: 8 } });

    expect(screen.getByText('0 online')).toBeInTheDocument();
    expect(screen.getByText('8 offline')).toBeInTheDocument();
    expect(screen.getByText('0 errored')).toBeInTheDocument();
  });

  it('shows the empty line instead of children when the group has no members', () => {
    renderGroup({ expanded: true, memberCount: 0 });

    expect(screen.getByText('No agents in group')).toBeInTheDocument();
    expect(screen.queryByText('member-a')).not.toBeInTheDocument();
    expect(screen.queryByText('member-b')).not.toBeInTheDocument();
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderGroup();

    await user.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('toggles from the keyboard via native button Enter and Space activation', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderGroup();
    const button = screen.getByRole('button');

    button.focus();
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
