import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteFolderBrowser } from './RemoteFolderBrowser';
import { resetOverlayDismissStackForTests } from '../shared/overlayDismissStack';

import type {
  RemoteFolderBrowserListing,
  RemoteFolderBrowserState,
} from '@/hooks/useRemoteFolderBrowser';

const LOADING_CAPTION = 'Waiting for folder selection on laptop...';

function makeListing(
  overrides: Partial<RemoteFolderBrowserListing> = {}
): RemoteFolderBrowserListing {
  return {
    path: '/srv/app',
    parentPath: '/srv',
    requestedPath: '/srv/app',
    entries: [{ name: 'alpha' }, { name: 'beta', symlink: true }, { name: 'gamma' }],
    dirCount: 12,
    fileCount: 3,
    hiddenCount: 0,
    truncated: false,
    complete: true,
    selectable: true,
    fellBack: false,
    ...overrides,
  };
}

function makeBrowser(overrides: Partial<RemoteFolderBrowserState> = {}): RemoteFolderBrowserState {
  return {
    phase: 'ready',
    machineDisplayName: 'laptop-m2',
    listing: makeListing(),
    isNavigating: false,
    showHidden: false,
    filter: '',
    error: null,
    navigate: vi.fn(),
    goUp: vi.fn(),
    goHome: vi.fn(),
    setShowHidden: vi.fn(),
    setFilter: vi.fn(),
    retry: vi.fn(),
    select: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

function renderPanel(browser: RemoteFolderBrowserState, onExit = vi.fn()) {
  render(
    <RemoteFolderBrowser
      id="panel"
      loadingCaption={LOADING_CAPTION}
      browser={browser}
      onExit={onExit}
    />
  );
  return { onExit };
}

function footerStatus(text: string): HTMLElement {
  return screen.getByText(text);
}

describe('RemoteFolderBrowser', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    resetOverlayDismissStackForTests();
  });

  it('loading: shows the caption, five skeletons, and disables every control', () => {
    const browser = makeBrowser({ phase: 'loading', listing: null });
    const { container } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={browser}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByText(LOADING_CAPTION)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Up one folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Home folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh folder' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Filter folders' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show hidden' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(footerStatus('Loading folders…')).toBeInTheDocument();
  });

  it('ready: lists folders with a Link badge for symlinks, counts, and an enabled Select', () => {
    renderPanel(makeBrowser());

    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
    const beta = screen.getByRole('button', { name: /beta/ });
    expect(within(beta).getByText('Link')).toBeInTheDocument();
    expect(screen.getByText('12 folders', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/3 files/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Folder: /srv/app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled();
  });

  it('ready with a null listing renders the loading body, not an empty list', () => {
    const { container } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={makeBrowser({ listing: null })}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByText(LOADING_CAPTION)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('navigating: keeps the rows, shows the progress bar, marks the list busy, and disables Select', () => {
    renderPanel(
      makeBrowser({
        isNavigating: true,
        listing: makeListing({ path: '/srv/app/web' }),
      })
    );

    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByTestId('remote-folder-browser-progress')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Folders in /srv/app/web' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(footerStatus('Loading /srv/app/web…')).toBeInTheDocument();
  });

  it('clicking a row navigates to its full path, which is also the row title', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    renderPanel(browser);

    const alpha = screen.getByRole('button', { name: 'alpha' });
    expect(alpha).toHaveAttribute('title', '/srv/app/alpha');
    await user.click(alpha);

    expect(browser.navigate).toHaveBeenCalledWith('/srv/app/alpha');
  });

  it('Enter on a focused row navigates into it', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    renderPanel(browser);

    screen.getByRole('button', { name: 'alpha' }).focus();
    await user.keyboard('{Enter}');

    expect(browser.navigate).toHaveBeenCalledWith('/srv/app/alpha');
  });

  it('Backspace in the list goes up, and does nothing at the top', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    const { unmount } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={browser}
        onExit={vi.fn()}
      />
    );
    screen.getByRole('button', { name: 'alpha' }).focus();
    await user.keyboard('{Backspace}');
    expect(browser.goUp).toHaveBeenCalledTimes(1);
    unmount();

    const top = makeBrowser({ listing: makeListing({ parentPath: null }) });
    renderPanel(top);
    screen.getByRole('button', { name: 'alpha' }).focus();
    await user.keyboard('{Backspace}');
    expect(top.goUp).not.toHaveBeenCalled();
  });

  it('ArrowDown moves focus to the next row; Home and End move to the first and last', async () => {
    const user = userEvent.setup();
    renderPanel(makeBrowser());

    screen.getByRole('button', { name: 'alpha' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /beta/ })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'gamma' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'alpha' })).toHaveFocus();
  });

  it('a new folder focuses its first row when focus was in the list', () => {
    const { rerender } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={makeBrowser()}
        onExit={vi.fn()}
      />
    );
    screen.getByRole('button', { name: 'gamma' }).focus();

    rerender(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={makeBrowser({
          listing: makeListing({
            path: '/srv/app/alpha',
            entries: [{ name: 'nested' }],
            dirCount: 1,
            fileCount: 0,
          }),
        })}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'nested' })).toHaveFocus();
  });

  it('a new folder leaves focus alone when focus was outside the list', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={makeBrowser()}
        onExit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Refresh folder' }));

    rerender(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={makeBrowser({
          listing: makeListing({ path: '/srv/other', entries: [{ name: 'x' }], dirCount: 1 }),
        })}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Refresh folder' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'x' })).not.toHaveFocus();
  });

  it('typing in the filter calls setFilter, and Enter there never submits the parent form', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <RemoteFolderBrowser
          id="panel"
          loadingCaption={LOADING_CAPTION}
          browser={browser}
          onExit={vi.fn()}
        />
      </form>
    );

    const filter = screen.getByRole('textbox', { name: 'Filter folders' });
    fireEvent.change(filter, { target: { value: 'web' } });
    expect(browser.setFilter).toHaveBeenCalledWith('web');

    filter.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the hidden toggle calls setShowHidden and reflects the pressed state', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({ listing: makeListing({ hiddenCount: 4 }) });
    const { unmount } = render(
      <RemoteFolderBrowser
        id="panel"
        loadingCaption={LOADING_CAPTION}
        browser={browser}
        onExit={vi.fn()}
      />
    );
    const toggle = screen.getByRole('button', { name: 'Show hidden · 4' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(browser.setShowHidden).toHaveBeenCalledWith(true);
    unmount();

    renderPanel(makeBrowser({ showHidden: true }));
    const hide = screen.getByRole('button', { name: 'Hide hidden' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
  });

  it('Select calls select() and reports the select exit', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    const { onExit } = renderPanel(browser);

    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(browser.select).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('select');
  });

  it('on the root, Select is disabled, explains why, and is linked to the reason', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({
      listing: makeListing({ path: '/', parentPath: null, selectable: false }),
    });
    renderPanel(browser);

    const select = screen.getByRole('button', { name: 'Select' });
    const reason = footerStatus("The root folder can't be a workspace. Open a folder inside it.");
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-describedby', reason.id);
    await user.click(select);
    expect(browser.select).not.toHaveBeenCalled();
  });

  it('Cancel calls cancel() and reports the cancel exit', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    const { onExit } = renderPanel(browser);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(browser.cancel).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('cancel');
  });

  it('Escape clears a non-empty filter first and keeps the panel open', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({ filter: 'web' });
    const { onExit } = renderPanel(browser);

    await user.keyboard('{Escape}');

    expect(browser.setFilter).toHaveBeenCalledWith('');
    expect(browser.cancel).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Escape with an empty filter cancels the browser', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser();
    const { onExit } = renderPanel(browser);

    await user.keyboard('{Escape}');

    expect(browser.cancel).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('cancel');
  });

  it('error with a listing: shows the alert and Retry, keeps the rows, and leaves Select enabled', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({
      phase: 'error',
      error: { code: 'READ_FAILED', message: 'denied', path: '/Users/me/private' },
    });
    renderPanel(browser);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not read /Users/me/private. Try again or choose another folder.'
    );
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(browser.retry).toHaveBeenCalledTimes(1);
  });

  it('error without a listing: shows the error body with Try again and the footer reason', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({
      phase: 'error',
      listing: null,
      error: { code: 'READ_FAILED', message: 'denied', path: '/srv/app' },
    });
    renderPanel(browser);

    expect(
      screen.getByText('Could not read /srv/app. Try again or choose another folder.')
    ).toBeInTheDocument();
    expect(
      footerStatus('This folder could not be read. Try again or type a path.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(browser.retry).toHaveBeenCalledTimes(1);
  });

  it('no-response without a listing: shows the body, Try again, and the footer reason', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({ phase: 'no-response', listing: null });
    renderPanel(browser);

    expect(
      screen.getByText(
        'laptop-m2 did not answer within 15 seconds. Its daemon may be offline, or its CLI may be too old to browse folders.'
      )
    ).toBeInTheDocument();
    expect(footerStatus('No response from laptop-m2. Try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(browser.retry).toHaveBeenCalledTimes(1);
  });

  it('no-response with a listing: shows the notice, keeps the rows, and disables Select', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({ phase: 'no-response', isNavigating: true });
    renderPanel(browser);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent(
      'laptop-m2 did not answer within 15 seconds. The folder list may be out of date.'
    );
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
    expect(
      footerStatus('No response from laptop-m2. Try again to choose a folder.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
    await user.click(within(notice).getByRole('button', { name: 'Try again' }));
    expect(browser.retry).toHaveBeenCalledTimes(1);
  });

  it('a fellBack listing shows the nearest-folder notice', () => {
    renderPanel(
      makeBrowser({
        listing: makeListing({
          path: '/srv',
          requestedPath: '/srv/missing',
          fellBack: true,
        }),
      })
    );

    expect(
      screen.getByText('/srv/missing does not exist. Showing /srv, the nearest folder that does.')
    ).toBeInTheDocument();
  });

  it('an incomplete scan shows the early-stop warning', () => {
    renderPanel(makeBrowser({ listing: makeListing({ complete: false }) }));

    expect(
      screen.getByText(
        'The scan stopped early, so some folders may be missing. Filter only searches folders already scanned; type a full path to open one directly.'
      )
    ).toBeInTheDocument();
  });

  it('a truncated listing shows the first-N notice using the entry count and the folder count', () => {
    renderPanel(makeBrowser({ listing: makeListing({ truncated: true }) }));

    expect(
      screen.getByText('Showing the first 3 of 12 folders. Type in Filter to narrow the list.')
    ).toBeInTheDocument();
  });

  it('ended: shows the ended body and Reopen, disables the controls, and hides every notice', async () => {
    const user = userEvent.setup();
    const browser = makeBrowser({
      phase: 'ended',
      error: { code: 'READ_FAILED', message: 'x', path: '/srv/app' },
      listing: makeListing({ truncated: true, complete: false }),
    });
    renderPanel(browser);

    expect(
      screen.getByText(
        'This folder browser session ended after 10 minutes of inactivity, or was removed.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Folders in/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Up one folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Home folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh folder' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Filter folders' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
    expect(footerStatus('This session ended. Reopen to choose a folder.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(browser.retry).toHaveBeenCalledTimes(1);
  });

  describe('empty variants', () => {
    it('variant A: a filter that matches nothing offers Clear filter', async () => {
      const user = userEvent.setup();
      const browser = makeBrowser({
        filter: 'web',
        listing: makeListing({ entries: [], dirCount: 0, fileCount: 2 }),
      });
      renderPanel(browser);

      expect(screen.getByText('No folders match “web”.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear filter' }));
      expect(browser.setFilter).toHaveBeenCalledWith('');
    });

    it('variant B: an empty folder says so and points at Select', () => {
      renderPanel(
        makeBrowser({
          listing: makeListing({ entries: [], dirCount: 0, fileCount: 0, hiddenCount: 0 }),
        })
      );

      expect(screen.getByText('No subfolders here.')).toBeInTheDocument();
      expect(screen.getByText('Select this folder, or go up one level.')).toBeInTheDocument();
    });

    it('variant C: only hidden items offers Show hidden', async () => {
      const user = userEvent.setup();
      const browser = makeBrowser({
        listing: makeListing({ entries: [], dirCount: 0, fileCount: 0, hiddenCount: 3 }),
      });
      renderPanel(browser);

      expect(screen.getByText('No visible subfolders. 3 hidden items.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show hidden' }));
      expect(browser.setShowHidden).toHaveBeenCalledWith(true);
    });

    it('variant D: files but no subfolders explains the files', () => {
      renderPanel(
        makeBrowser({
          listing: makeListing({ entries: [], dirCount: 0, fileCount: 5, hiddenCount: 0 }),
        })
      );

      expect(screen.getByText('No subfolders. This folder has 5 files.')).toBeInTheDocument();
    });
  });
});
