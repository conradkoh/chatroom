import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryRow, type RowCreateMessage } from './RepositoryRow';
import type { LedgerEntryView } from '../hooks/useRepositoryLedger';

function makeEntry(overrides: Partial<LedgerEntryView> = {}): LedgerEntryView {
  return {
    path: '/Users/me/projects/app',
    name: 'app',
    root: '/Users/me/projects',
    branch: 'main',
    discoveredAt: 1,
    hasChatroom: false,
    ...overrides,
  };
}

function renderRow(
  entry: LedgerEntryView,
  props: Partial<{ disabled: boolean; creating: boolean; message: RowCreateMessage }> = {}
) {
  const onCreate = vi.fn();
  const view = render(
    <RepositoryRow entry={entry} disabled={false} creating={false} onCreate={onCreate} {...props} />
  );
  return { onCreate, unmount: view.unmount };
}

/** The path line is the only element with a title attribute inside the row. */
function pathLine(): Element {
  const line = screen.getByTestId('repository-row').querySelector('[title]');
  if (!line) throw new Error('row has no titled path line');
  return line;
}

describe('RepositoryRow', () => {
  it('shows the No chatroom badge and creates from the button', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderRow(makeEntry());

    expect(screen.getByText('No chatroom')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Create chatroom' }));

    expect(onCreate).toHaveBeenCalledWith('/Users/me/projects/app');
  });

  it('shows the Has chatroom badge and an Open link', () => {
    renderRow(makeEntry({ hasChatroom: true, chatroomId: 'room-1' as Id<'chatroom_rooms'> }));

    expect(screen.getByText('Has chatroom')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/app/chatroom?id=room-1'
    );
    expect(screen.queryByRole('button', { name: 'Create chatroom' })).toBeNull();
  });

  it('renders "no branch" when the branch is unknown', () => {
    renderRow(makeEntry({ branch: undefined }));

    expect(screen.getByText('no branch')).toBeDefined();
  });

  it('dims exactly the root prefix of the path', () => {
    renderRow(makeEntry());

    const line = pathLine();
    expect(line.getAttribute('title')).toContain('/Users/me/projects/app');
    expect(line.getAttribute('title')).toContain('Root: /Users/me/projects');
    const [prefix, rest] = line.querySelectorAll('span');
    expect(prefix.textContent).toBe('/Users/me/projects');
    expect(prefix.className).toContain('text-chatroom-text-muted');
    expect(rest.textContent).toBe('/app');
    expect(rest.className).toContain('text-chatroom-text-primary');
  });

  it('renders the whole path as primary when it is not under the root', () => {
    renderRow(makeEntry({ path: '/elsewhere/app', root: '/Users/me/projects' }));

    const line = pathLine();
    expect(line.getAttribute('title')).toContain('/elsewhere/app');
    const [prefix, rest] = line.querySelectorAll('span');
    expect(prefix.textContent).toBe('');
    expect(rest.textContent).toBe('/elsewhere/app');
    expect(rest.className).toContain('text-chatroom-text-primary');
  });

  it('keeps a fixed-width action column in both states', () => {
    const { unmount } = render(
      <RepositoryRow entry={makeEntry()} disabled={false} creating={false} onCreate={vi.fn()} />
    );
    expect(
      screen.getByRole('button', { name: 'Create chatroom' }).parentElement?.className
    ).toContain('w-[8.5rem]');
    unmount();

    render(
      <RepositoryRow
        entry={makeEntry({ hasChatroom: true, chatroomId: 'room-1' as Id<'chatroom_rooms'> })}
        disabled={false}
        creating={false}
        onCreate={vi.fn()}
      />
    );
    expect(screen.getByRole('link', { name: 'Open' }).parentElement?.className).toContain(
      'w-[8.5rem]'
    );
  });

  it('shows the inline message as an alert in the left column', () => {
    renderRow(makeEntry(), {
      message: { text: 'This repository already has a chatroom.', tone: 'alert' },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This repository already has a chatroom.');
    expect(alert.parentElement).toHaveClass('min-w-0');
    expect(alert.closest('.w-\\[8\\.5rem\\]')).toBeNull();
  });

  it('renders no alert when the row has no message', () => {
    renderRow(makeEntry());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the inline message once the row has a chatroom', () => {
    renderRow(makeEntry({ hasChatroom: true, chatroomId: 'room-1' as Id<'chatroom_rooms'> }), {
      message: { text: 'This repository already has a chatroom.', tone: 'alert' },
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open' })).toBeDefined();
  });

  it('shows a skip as a neutral status line, not an alert', () => {
    renderRow(makeEntry(), {
      message: { text: 'This repository already has a chatroom.', tone: 'status' },
    });

    expect(screen.queryByRole('alert')).toBeNull();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('This repository already has a chatroom.');
    expect(status).toHaveClass('text-chatroom-text-muted');
    expect(status).not.toHaveClass('text-chatroom-status-error');
  });

  it('disables the create button and shows progress while creating', () => {
    const { onCreate, unmount } = renderRow(makeEntry(), { disabled: true });
    expect(screen.getByRole('button', { name: 'Create chatroom' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
    unmount();

    render(<RepositoryRow entry={makeEntry()} disabled={false} creating onCreate={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Creating/ });
    expect(button).toBeDisabled();
    expect(button.textContent).toContain('Creating…');
  });
});
