import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceCapabilitiesRefreshButton } from './WorkspaceCapabilitiesRefreshButton';

const refreshMock = vi.fn();

vi.mock('../hooks/useRefreshCapabilities', () => ({
  useRefreshCapabilities: () => ({ refresh: refreshMock }),
}));

describe('WorkspaceCapabilitiesRefreshButton', () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it('calls refresh with workspace id on click', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCapabilitiesRefreshButton workspaceId="ws-1" />);

    await user.click(screen.getByTestId('workspace-capabilities-refresh-button'));

    expect(refreshMock).toHaveBeenCalledWith('ws-1');
  });

  it('shows success tick when providers arrive after refresh', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <WorkspaceCapabilitiesRefreshButton workspaceId="ws-1" hasProviders={false} />
    );

    await user.click(screen.getByTestId('workspace-capabilities-refresh-button'));
    rerender(<WorkspaceCapabilitiesRefreshButton workspaceId="ws-1" hasProviders />);

    expect(await screen.findByLabelText('Harness and model list refreshed')).toBeInTheDocument();
  });
});
