import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SetupWorkspaceStep } from './SetupWorkspaceStep';
import type { UserMachine } from '../../types/machine';

vi.mock('@/hooks/useMachineCapabilities', () => ({
  useMachineCapabilities: () => ({ availableHarnesses: ['cursor'], harnessVersions: {} }),
}));

vi.mock('@/hooks/useFolderPicker', () => ({
  useFolderPicker: () => ({
    pickFolder: vi.fn(),
    request: undefined,
    requestId: null,
    reset: vi.fn(),
    isPending: false,
    isTimedOut: false,
  }),
}));

const MACHINE: UserMachine = {
  machineId: 'machine-a',
  hostname: 'laptop',
  os: 'darwin',
  registeredAt: 1,
} as UserMachine;

function footerOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[data-slot="setup-step-footer"]');
}

describe('SetupWorkspaceStep shared footer', () => {
  it('keeps Confirm Workspace in the footer, disabled until a folder is set', async () => {
    const user = userEvent.setup();
    render(
      <SetupWorkspaceStep
        connectedMachines={[MACHINE]}
        isLoadingMachines={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const confirm = screen.getByRole('button', { name: 'Confirm Workspace' });
    expect(footerOf(confirm)).not.toBeNull();
    expect(confirm).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Select a folder on/), '/tmp/workspace');
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('confirms with the selected machine and the typed folder', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SetupWorkspaceStep
        connectedMachines={[MACHINE]}
        isLoadingMachines={false}
        onConfirm={onConfirm}
      />
    );

    await user.type(screen.getByPlaceholderText(/Select a folder on/), '/tmp/workspace');
    await user.click(screen.getByRole('button', { name: 'Confirm Workspace' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('machine-a', '/tmp/workspace'));
  });

  it('shows no footer while no machine is connected', () => {
    render(
      <SetupWorkspaceStep connectedMachines={[]} isLoadingMachines={false} onConfirm={vi.fn()} />
    );

    expect(document.querySelector('[data-slot="setup-step-footer"]')).toBeNull();
  });
});

describe('SetupWorkspaceStep default machine', () => {
  it('keeps the auto-selected machine when a second machine connects', () => {
    const SECOND: UserMachine = {
      machineId: 'machine-b',
      hostname: 'desktop',
      os: 'linux',
      registeredAt: 2,
    } as UserMachine;
    const common = { isLoadingMachines: false, onConfirm: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<SetupWorkspaceStep {...common} connectedMachines={[]} />);

    rerender(<SetupWorkspaceStep {...common} connectedMachines={[MACHINE]} />);
    expect(screen.getByPlaceholderText('Select a folder on laptop')).toBeInTheDocument();

    rerender(<SetupWorkspaceStep {...common} connectedMachines={[MACHINE, SECOND]} />);
    expect(screen.getByPlaceholderText('Select a folder on laptop')).toBeInTheDocument();
  });
});
