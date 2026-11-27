import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SetupMachinePicker } from './SetupMachinePicker';
import type { UserMachine } from '../../types/machine';

const MACHINES = [
  { machineId: 'm1', hostname: 'laptop', os: 'darwin', registeredAt: 1 },
  { machineId: 'm2', hostname: 'desktop', os: 'darwin', registeredAt: 2 },
] as UserMachine[];

describe('SetupMachinePicker', () => {
  it('labels an offline-selectable machine and keeps it clickable', async () => {
    const user = userEvent.setup();
    const onSelectMachine = vi.fn();
    render(
      <SetupMachinePicker
        machines={MACHINES}
        selectedMachineId={null}
        onSelectMachine={onSelectMachine}
        offlineMachineIds={new Set(['m2'])}
      />
    );

    const row = screen.getByRole('button', { name: /desktop/i });
    expect(row).toHaveTextContent('Offline');
    expect(row).toBeEnabled();

    await user.click(row);
    expect(onSelectMachine).toHaveBeenCalledWith('m2');
  });

  it('disables a machine in disabledMachineIds', async () => {
    const user = userEvent.setup();
    const onSelectMachine = vi.fn();
    render(
      <SetupMachinePicker
        machines={MACHINES}
        selectedMachineId={null}
        onSelectMachine={onSelectMachine}
        disabledMachineIds={new Set(['m1'])}
      />
    );

    const row = screen.getByRole('button', { name: /laptop/i });
    expect(row).toBeDisabled();

    await user.click(row);
    expect(onSelectMachine).not.toHaveBeenCalled();
  });
});
