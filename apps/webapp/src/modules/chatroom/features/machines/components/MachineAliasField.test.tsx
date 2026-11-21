import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineAliasField } from './MachineAliasField';

const mocks = vi.hoisted(() => ({
  setMachineAlias: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.setMachineAlias,
}));

function renderField(props: Partial<React.ComponentProps<typeof MachineAliasField>> = {}) {
  return render(
    <MachineAliasField machineId="machine-1" hostname="host-1" alias="Laptop" {...props} />
  );
}

describe('MachineAliasField', () => {
  beforeEach(() => {
    mocks.setMachineAlias.mockReset();
    mocks.setMachineAlias.mockResolvedValue({ success: true });
  });

  it('shows the alias when set', () => {
    renderField();

    expect(screen.getByTestId('machine-name').textContent).toBe('Laptop');
  });

  it('falls back to the hostname when no alias is set', () => {
    renderField({ alias: undefined });

    expect(screen.getByTestId('machine-name').textContent).toBe('host-1');
  });

  it('enters edit mode on pencil click with the alias prefilled and focused', () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));

    const input = screen.getByTestId('machine-alias-input') as HTMLInputElement;
    expect(input.value).toBe('Laptop');
    expect(document.activeElement).toBe(input);
  });

  it('saves a new alias with Enter', async () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.change(screen.getByTestId('machine-alias-input'), { target: { value: 'Work' } });
    fireEvent.keyDown(screen.getByTestId('machine-alias-input'), { key: 'Enter' });

    await waitFor(() => {
      expect(mocks.setMachineAlias).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setMachineAlias).toHaveBeenCalledWith({ machineId: 'machine-1', alias: 'Work' });
    await waitFor(() => {
      expect(screen.queryByTestId('machine-alias-input')).toBeNull();
    });
    expect(screen.getByTestId('machine-name')).toBeDefined();
  });

  it('saves a new alias with the Save button', async () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.change(screen.getByTestId('machine-alias-input'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByTestId('machine-alias-save'));

    await waitFor(() => {
      expect(mocks.setMachineAlias).toHaveBeenCalledWith({ machineId: 'machine-1', alias: 'Work' });
    });
  });

  it('clears the alias when the input is emptied', async () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.change(screen.getByTestId('machine-alias-input'), { target: { value: '' } });
    fireEvent.keyDown(screen.getByTestId('machine-alias-input'), { key: 'Enter' });

    await waitFor(() => {
      expect(mocks.setMachineAlias).toHaveBeenCalledWith({
        machineId: 'machine-1',
        alias: undefined,
      });
    });
  });

  it('does nothing when the value is unchanged', async () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.keyDown(screen.getByTestId('machine-alias-input'), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByTestId('machine-alias-input')).toBeNull();
    });
    expect(mocks.setMachineAlias).not.toHaveBeenCalled();
  });

  it('cancels with Escape without saving', () => {
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.change(screen.getByTestId('machine-alias-input'), { target: { value: 'Work' } });
    fireEvent.keyDown(screen.getByTestId('machine-alias-input'), { key: 'Escape' });

    expect(screen.queryByTestId('machine-alias-input')).toBeNull();
    expect(screen.getByTestId('machine-name').textContent).toBe('Laptop');
    expect(mocks.setMachineAlias).not.toHaveBeenCalled();
  });

  it('stays in edit mode and shows friendly copy when saving fails', async () => {
    mocks.setMachineAlias.mockRejectedValue(new Error('[CONVEX M(machines:setMachineAlias)] boom'));
    renderField();

    fireEvent.click(screen.getByTestId('machine-alias-edit'));
    fireEvent.change(screen.getByTestId('machine-alias-input'), { target: { value: 'Work' } });
    fireEvent.keyDown(screen.getByTestId('machine-alias-input'), { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('machine-alias-error').textContent).toBe(
        'Could not save the name. Try again.'
      );
    });
    const input = screen.getByTestId('machine-alias-input') as HTMLInputElement;
    expect(input.value).toBe('Work');
    expect(screen.queryByText(/\[CONVEX/)).toBeNull();
  });

  it('enters edit mode when startEditSignal changes to a truthy value', () => {
    const { rerender } = render(
      <MachineAliasField
        machineId="machine-1"
        hostname="host-1"
        alias="Laptop"
        startEditSignal={0}
      />
    );
    expect(screen.queryByTestId('machine-alias-input')).toBeNull();

    rerender(
      <MachineAliasField
        machineId="machine-1"
        hostname="host-1"
        alias="Laptop"
        startEditSignal={1}
      />
    );

    expect(screen.getByTestId('machine-alias-input')).toBeDefined();
  });
});
