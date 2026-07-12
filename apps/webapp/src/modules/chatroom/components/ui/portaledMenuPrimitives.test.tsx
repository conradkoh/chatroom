import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  chatroomDropdownMenuContentClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { chatroomPortaledMenuSurfaceClassName } from '../shared/industrialDialogStyles';

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
});
