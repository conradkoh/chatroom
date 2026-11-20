import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StartWithFavoritesDialog } from './StartWithFavoritesDialog';
import type { StartWithFavoritesDialogProps } from '../hooks/useStartAgentsWithFavorites';
import type { FavoriteMismatch } from '../lib/favoriteStartMismatches';

const EXPLANATION =
  "Use favourites saves them as these agents' configuration, so future starts use them too. Start with current keeps every agent as it is.";

const mismatch = (overrides: Partial<FavoriteMismatch> = {}): FavoriteMismatch => ({
  workspaceId: 'ws-1',
  workspaceLabel: 'host-a:/repo',
  machineId: 'm1',
  workingDir: '/repo',
  role: 'builder',
  current: { agentHarness: 'opencode', model: 'claude-opus-4-8[effort=high]' },
  favorite: { agentHarness: 'pi', model: 'gpt-5.6-terra[reasoning=high]' },
  ...overrides,
});

/** Default props with a fresh mock for every callback. */
function makeProps(
  overrides: Partial<StartWithFavoritesDialogProps> = {}
): StartWithFavoritesDialogProps {
  return {
    open: true,
    phase: 'prompt',
    mismatches: [mismatch()],
    failures: [],
    showWorkspaceLabels: false,
    onUseFavourites: vi.fn(),
    onStartWithCurrent: vi.fn(),
    onStartAnyway: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

/** Renders the dialog with default props and returns every callback mock. */
function renderDialog(overrides: Partial<StartWithFavoritesDialogProps> = {}) {
  const props = makeProps(overrides);
  const view = render(<StartWithFavoritesDialog {...props} />);
  return { ...view, props };
}

describe('StartWithFavoritesDialog', () => {
  it('shows the singular intro for one mismatch', () => {
    renderDialog();

    expect(screen.getByText('1 agent is not using its top favourite model.')).toBeInTheDocument();
  });

  it('shows the plural intro for two mismatches', () => {
    renderDialog({ mismatches: [mismatch(), mismatch({ role: 'reviewer' })] });

    expect(
      screen.getByText('2 agents are not using their top favourite models.')
    ).toBeInTheDocument();
  });

  it('renders one row per mismatch as current → favourite', () => {
    renderDialog({ mismatches: [mismatch(), mismatch({ role: 'reviewer' })] });

    const rows = screen.getAllByTestId('start-favourites-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('builder');
    expect(rows[0]).toHaveTextContent('opencode · Claude Opus 4.8 [high]');
    expect(rows[0]).toHaveTextContent('pi · Gpt 5.6 Terra [high]');
  });

  it('shows the workspace suffix only when showWorkspaceLabels is true', () => {
    const twoMismatches = { mismatches: [mismatch(), mismatch({ role: 'reviewer' })] };
    const { props, unmount } = renderDialog(twoMismatches);

    expect(screen.queryByText('· host-a:/repo')).toBeNull();
    unmount();

    render(<StartWithFavoritesDialog {...props} showWorkspaceLabels />);

    expect(screen.getAllByText('· host-a:/repo')).toHaveLength(2);
  });

  it('renders the explanation and the three actions', () => {
    renderDialog();

    expect(screen.getByText(EXPLANATION)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start with current' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use favourites & start' })).toBeInTheDocument();
    expect(screen.getByTestId('start-favourites-cancel')).toHaveClass('w-full');
    expect(screen.getByTestId('start-favourites-current')).toHaveClass('w-full');
    expect(screen.getByTestId('start-favourites-use')).toHaveClass('w-full');
  });

  it('calls the matching callback for each action', () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByTestId('start-favourites-use'));
    expect(props.onUseFavourites).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('start-favourites-current'));
    expect(props.onStartWithCurrent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('start-favourites-cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    expect(props.onStartAnyway).not.toHaveBeenCalled();
    expect(props.onUseFavourites).toHaveBeenCalledTimes(1);
    expect(props.onStartWithCurrent).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('puts initial focus on the primary action', async () => {
    renderDialog();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('start-favourites-use'))
    );
  });

  it('Escape cancels in prompt', () => {
    const { props } = renderDialog();

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape is ignored while applying and starting', () => {
    for (const phase of ['applying', 'starting'] as const) {
      const { props, unmount } = renderDialog({ phase });

      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

      expect(props.onCancel).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('disables every action and labels the primary while applying', () => {
    const applying = renderDialog({ phase: 'applying' });

    expect(screen.getByTestId('start-favourites-use')).toHaveTextContent('Applying…');
    expect(screen.getByTestId('start-favourites-use')).toBeDisabled();
    expect(screen.getByTestId('start-favourites-current')).toBeDisabled();
    expect(screen.getByTestId('start-favourites-cancel')).toBeDisabled();
    applying.unmount();

    renderDialog({ phase: 'starting' });

    expect(screen.getByTestId('start-favourites-use')).toHaveTextContent('Starting…');
    expect(screen.getByTestId('start-favourites-use')).toBeDisabled();
    expect(screen.getByTestId('start-favourites-current')).toBeDisabled();
    expect(screen.getByTestId('start-favourites-cancel')).toBeDisabled();
  });

  it('apply-error replaces the list with failures and offers only Cancel and Start anyway', () => {
    renderDialog({
      phase: 'apply-error',
      mismatches: [mismatch(), mismatch({ role: 'reviewer' })],
      failures: [
        {
          role: 'reviewer',
          workspaceLabel: 'host-a:/repo',
          message: "Agent harness 'cursor' is not available on this machine",
        },
      ],
    });

    expect(screen.getByText('Could not apply 1 of 2 favourites')).toBeInTheDocument();
    expect(
      screen.getByText(
        "reviewer (host-a:/repo): Agent harness 'cursor' is not available on this machine"
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('start-favourites-row')).toHaveLength(0);
    expect(screen.queryByTestId('start-favourites-use')).toBeNull();
    expect(screen.queryByTestId('start-favourites-current')).toBeNull();
    expect(screen.getByTestId('start-favourites-start-anyway')).toHaveTextContent('Start anyway');
    expect(screen.getByTestId('start-favourites-cancel')).toBeInTheDocument();
  });

  it('apply-error initial focus is Start anyway', async () => {
    renderDialog({
      phase: 'apply-error',
      failures: [{ role: 'reviewer', workspaceLabel: 'host-a:/repo', message: 'boom' }],
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('start-favourites-start-anyway'))
    );
  });

  it('clicking Start anyway calls onStartAnyway', () => {
    const { props } = renderDialog({
      phase: 'apply-error',
      failures: [{ role: 'reviewer', workspaceLabel: 'host-a:/repo', message: 'boom' }],
    });

    fireEvent.click(screen.getByTestId('start-favourites-start-anyway'));

    expect(props.onStartAnyway).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('interacting inside the dialog does not reach a parent click or keydown handler', () => {
    const parentClick = vi.fn();
    const parentKeyDown = vi.fn();

    render(
      <div onClick={parentClick} onKeyDown={parentKeyDown}>
        <StartWithFavoritesDialog {...makeProps()} />
      </div>
    );

    fireEvent.click(screen.getByTestId('start-favourites-row'));
    fireEvent.click(screen.getByText('Start agents with your favourite models?'));
    fireEvent.keyDown(screen.getByTestId('start-favourites-use'), { key: 'Enter' });

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();

    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByTestId('start-favourites-dialog')).toBeNull();
  });
});
