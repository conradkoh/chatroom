import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EditableSessionTitle } from './EditableSessionTitle';

const renameSession = vi.fn().mockResolvedValue(undefined);

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => renameSession,
}));

const SESSION_SUMMARY = {
  _id: 'sess-1' as never,
  status: 'active' as const,
  harnessName: 'pi-sdk',
  sessionTitle: undefined,
  lastUsedConfig: { agent: 'builder' },
  workspaceId: 'ws-1' as never,
  createdAt: 1,
  lastActiveAt: 2,
};

describe('EditableSessionTitle', () => {
  beforeEach(() => {
    renameSession.mockClear();
  });

  it('shows the display title and enters edit mode on click', () => {
    render(
      <EditableSessionTitle harnessSessionId={'sess-1' as never} sessionSummary={SESSION_SUMMARY} />
    );

    expect(screen.getByText('builder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('builder');
  });

  it('saves a renamed title', async () => {
    render(
      <EditableSessionTitle harnessSessionId={'sess-1' as never} sessionSummary={SESSION_SUMMARY} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Session title' }), {
      target: { value: 'Fix auth bug' },
    });
    fireEvent.click(screen.getByTitle('Save title'));

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith({
        harnessSessionId: 'sess-1',
        sessionTitle: 'Fix auth bug',
      });
    });
  });
});
