import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './context-menu';

describe('ContextMenu', () => {
  it('renders an opaque sharp industrial surface and preserves item callbacks', () => {
    const onClick = vi.fn();
    render(
      <ContextMenu open>
        <ContextMenuTrigger>Open</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onClick}>Item</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
    expect(screen.getByText('Item').closest('[data-slot="context-menu-content"]')).toHaveClass(
      'bg-chatroom-bg-primary',
      'rounded-none'
    );
    expect(screen.getByText('Item')).toHaveClass('rounded-none', 'focus:bg-chatroom-bg-hover');
    fireEvent.click(screen.getByText('Item'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
