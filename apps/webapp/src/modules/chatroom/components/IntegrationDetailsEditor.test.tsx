import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationDetailsEditorProps } from './IntegrationDetailsEditor';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.update,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    integrations: {
      update: 'integrations.update',
    },
  },
}));

type Integration = IntegrationDetailsEditorProps['integration'];

function makeIntegration(overrides: Record<string, unknown> = {}): Integration {
  return {
    _id: 'integ-1',
    name: 'Old name',
    ...overrides,
  } as unknown as Integration;
}

describe('IntegrationDetailsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves only the changed field and closes without a success message', async () => {
    mocks.update.mockResolvedValue(undefined);
    const onClose = vi.fn();

    const { IntegrationDetailsEditor } = await import('./IntegrationDetailsEditor');
    render(<IntegrationDetailsEditor integration={makeIntegration()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.update).toHaveBeenCalledWith({ integrationId: 'integ-1', name: 'New name' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a save failure inline and keeps the editor open', async () => {
    mocks.update.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();

    const { IntegrationDetailsEditor } = await import('./IntegrationDetailsEditor');
    render(<IntegrationDetailsEditor integration={makeIntegration()} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });
});
