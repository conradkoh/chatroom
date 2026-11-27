import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildMachineActions } from './machineActions';
import { MachineActionsMenu } from './MachineActionsMenu';

function renderMenu() {
  const onRename = vi.fn();
  const onExport = vi.fn();
  const onImport = vi.fn();
  const onDelete = vi.fn();
  render(
    <MachineActionsMenu actions={buildMachineActions({ onRename, onExport, onImport, onDelete })} />
  );
  return { onRename, onExport, onImport, onDelete };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('machine-actions-trigger'));
  await screen.findAllByRole('menuitem');
  return user;
}

describe('MachineActionsMenu', () => {
  it('opens from the "Machine actions" trigger and lists rename, export, import then delete', async () => {
    renderMenu();
    await openMenu();

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Rename',
      'Export chatrooms',
      'Import chatrooms…',
      'Delete machine…',
    ]);
    expect(items.every((item) => !(item as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByTestId('machine-action-export').textContent).toBe('Export chatrooms');
    expect(screen.getByTestId('machine-action-import').textContent).toBe('Import chatrooms…');
  });

  it('separates the destructive action from the safe ones', async () => {
    renderMenu();
    await openMenu();

    const menu = await screen.findByRole('menu');
    const children = Array.from(menu.children);
    const separatorIndex = children.findIndex(
      (child) => child.getAttribute('data-slot') === 'dropdown-menu-separator'
    );
    expect(separatorIndex).toBe(3);

    const destructive = screen.getByTestId('machine-action-delete');
    expect(destructive.className).toContain('text-chatroom-status-error');
    expect(screen.getByTestId('machine-action-rename').className).not.toContain(
      'text-chatroom-status-error'
    );
  });

  it('calls the rename handler from its item', async () => {
    const { onRename, onExport, onImport, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-rename'));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls the export handler from its item', async () => {
    const { onRename, onExport, onImport, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-export'));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls the import handler from its item', async () => {
    const { onRename, onExport, onImport, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-import'));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls the delete handler from its item', async () => {
    const { onRename, onExport, onImport, onDelete } = renderMenu();
    const user = await openMenu();

    await user.click(screen.getByTestId('machine-action-delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
