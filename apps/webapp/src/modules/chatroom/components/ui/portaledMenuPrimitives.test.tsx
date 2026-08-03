import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  chatroomDropdownMenuContentClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import {
  chatroomPortaledMenuFloatingClassName,
  chatroomPortaledMenuSurfaceClassName,
} from '../shared/industrialDialogStyles';

import { FixedModal } from '@/components/ui/fixed-modal';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function expectOpaquePortaledSurface(className: string) {
  expect(className).toContain('bg-chatroom-bg-primary');
  expect(className).not.toContain('bg-chatroom-bg-surface');
  expect(className).not.toContain('backdrop-blur');
}

describe('chatroomPortaledMenuSurfaceClassName', () => {
  it('uses opaque primary background for portaled menus', () => {
    expectOpaquePortaledSurface(chatroomPortaledMenuSurfaceClassName);
  });
});

describe('chatroomPortaledMenuFloatingClassName', () => {
  it('uses z-index above FixedModal base layer', () => {
    expect(chatroomPortaledMenuFloatingClassName).toContain('z-50');
    expect(chatroomPortaledMenuFloatingClassName).toContain('pointer-events-auto');
    expectOpaquePortaledSurface(chatroomPortaledMenuFloatingClassName);
  });
});

describe('chatroomDropdownMenuContentClassName', () => {
  it('includes shared opaque portaled surface', () => {
    expectOpaquePortaledSurface(chatroomDropdownMenuContentClassName);
  });
});

describe('DropdownMenuContent', () => {
  it('renders with opaque chatroom primary background', () => {
    render(
      <DropdownMenu open onOpenChange={vi.fn()} modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button">open</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="dropdown-content">item</DropdownMenuContent>
      </DropdownMenu>
    );

    expectOpaquePortaledSurface(screen.getByTestId('dropdown-content').className);
  });
});

describe('DropdownMenuContent inside FixedModal', () => {
  it('portals content into the FixedModal portal host (not document.body)', () => {
    render(
      <FixedModal isOpen onClose={() => undefined}>
        <DropdownMenu open onOpenChange={vi.fn()} modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button">open</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="dropdown-content">item</DropdownMenuContent>
        </DropdownMenu>
      </FixedModal>
    );

    const content = screen.getByTestId('dropdown-content');
    const host = document.body.querySelector('[data-slot="chatroom-dialog-portal-host"]');
    expect(host).not.toBeNull();
    expect(host?.contains(content)).toBe(true);
  });

  it('nested FixedModal (list -> detail): portals into the innermost modal host', () => {
    render(
      <FixedModal isOpen onClose={() => undefined}>
        <FixedModal isOpen onClose={() => undefined}>
          <DropdownMenu open onOpenChange={vi.fn()} modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button">open</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-testid="dropdown-content">item</DropdownMenuContent>
          </DropdownMenu>
        </FixedModal>
      </FixedModal>
    );

    const content = screen.getByTestId('dropdown-content');
    const hosts = document.body.querySelectorAll('[data-slot="chatroom-dialog-portal-host"]');
    expect(hosts.length).toBe(2);
    expect(hosts[1].contains(content)).toBe(true);
  });

  it('registers above FixedModal so escape dismisses dropdown before modal', () => {
    const onModalClose = vi.fn();
    const onDropdownOpenChange = vi.fn();

    const view = render(
      <FixedModal isOpen onClose={onModalClose}>
        <DropdownMenu open onOpenChange={onDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <button type="button">open</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="dropdown-content">item</DropdownMenuContent>
        </DropdownMenu>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onModalClose).not.toHaveBeenCalled();

    view.rerender(
      <FixedModal isOpen onClose={onModalClose}>
        <DropdownMenu open={false} onOpenChange={onDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <button type="button">open</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="dropdown-content">item</DropdownMenuContent>
        </DropdownMenu>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });
});

describe('SelectContent', () => {
  it('renders with opaque chatroom primary background', () => {
    render(
      <Select open onOpenChange={vi.fn()} value="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-testid="select-content">
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>
    );

    expectOpaquePortaledSurface(screen.getByTestId('select-content').className);
  });
});

describe('PopoverContent', () => {
  it('renders with opaque chatroom primary background', () => {
    render(
      <Popover open onOpenChange={vi.fn()}>
        <PopoverTrigger asChild>
          <button type="button">open</button>
        </PopoverTrigger>
        <PopoverContent data-testid="popover-content">panel</PopoverContent>
      </Popover>
    );

    expectOpaquePortaledSurface(screen.getByTestId('popover-content').className);
  });

  it('stacks above FixedModal overlay z-index', () => {
    render(
      <FixedModal isOpen onClose={() => undefined}>
        <Popover open onOpenChange={vi.fn()}>
          <PopoverTrigger asChild>
            <button type="button">open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="popover-content">panel</PopoverContent>
        </Popover>
      </FixedModal>
    );

    const popoverContent = screen.getByTestId('popover-content');
    expect(popoverContent.className).toContain('z-50');
    expect(popoverContent.className).not.toContain('z-[100]');

    const modalContent = document.body.querySelector<HTMLElement>('.chatroom-root');
    expect(modalContent).not.toBeNull();
    expect(modalContent?.className).toContain('z-50');
  });

  it('registers above FixedModal so escape dismisses popover before modal', () => {
    const onModalClose = vi.fn();
    const onPopoverOpenChange = vi.fn();

    const view = render(
      <FixedModal isOpen onClose={onModalClose}>
        <Popover open onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <button type="button">open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="popover-content">panel</PopoverContent>
        </Popover>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onModalClose).not.toHaveBeenCalled();

    view.rerender(
      <FixedModal isOpen onClose={onModalClose}>
        <Popover open={false} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <button type="button">open</button>
          </PopoverTrigger>
          <PopoverContent data-testid="popover-content">panel</PopoverContent>
        </Popover>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });
});
