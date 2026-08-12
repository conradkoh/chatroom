import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './dropdown-menu';

describe('DropdownMenu', () => {
  it('renders menu items when open', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button />}>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('renders label inside group without MenuGroupContext error', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button />}>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Section</DropdownMenuLabel>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Item')).toBeInTheDocument();
  });

  it('calls onSelect when menu item is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button />}>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await userEvent.click(screen.getByText('Edit'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
