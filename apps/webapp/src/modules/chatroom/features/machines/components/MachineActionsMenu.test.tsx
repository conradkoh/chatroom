import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildMachineActions } from './machineActions';
import { MachineActionsMenu } from './MachineActionsMenu';

function renderMenu() {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(<MachineActionsMenu actions={buildMachineActions({ onRename, onDelete })} />);
  return { onRename, onDelete };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('machine-actions-trigger'));
  await screen.findAllByRole('menuitem');
  return user;
}

describe('MachineActionsMenu', () => {
  it('opens from the "Machine actions" trigger and lists rename then delete', async () => {
    renderMenu();
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Rename', 'Delete machine…']);
    expect(items.every((item) => !(item as HTMLButtonElement).disabled)).toBe(true);
  });

  it('separates the destructive action from the safe ones', async () => {
    renderMenu();
    await openMenu();

    const menu = await screen.findByRole('menu');
    const children = Array.from(menu.children);
    const separatorIndex = children.findIndex(
      (child) => child.getAttribute('data-slot') === 'dropdown-menu-separator'
    );
    expect(separatorIndex).toBe(1);

    const destructive = screen.getByTestId('machine-action-delete');
    expect(destructive.className).toContain('text-chatroom-status-error');
    expect(screen.getByTestId('machine-action-rename').className).not.toContain(
      'text-chatroom-status-error'
    );
  });

  it('calls the rename handler from its item', async () => {
    const { onRename, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-rename'));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls the delete handler from its item', async () => {
    const { onRename, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
  });
});
