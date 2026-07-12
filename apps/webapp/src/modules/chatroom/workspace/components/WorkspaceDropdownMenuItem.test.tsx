import { render, screen } from '@testing-library/react';
import { Copy } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceDropdownMenuItem } from './WorkspaceDropdownMenuItem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

describe('WorkspaceDropdownMenuItem', () => {
  it('renders icon and label with shared workspace menu spacing', () => {
    render(
      <DropdownMenu open onOpenChange={vi.fn()} modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button">open</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorkspaceDropdownMenuItem icon={Copy} onSelect={vi.fn()}>
            Copy Relative Path
          </WorkspaceDropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const content = document.querySelector('[data-slot="chatroom-dropdown-menu-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain('bg-chatroom-bg-primary');
    expect(content?.className).not.toContain('bg-chatroom-bg-surface');

    const item = screen.getByRole('menuitem', { name: /copy relative path/i });
    expect(item.className).toContain('gap-1.5');
    expect(item.className).toContain('text-chatroom-text-primary');
    expect(item.className).not.toMatch(/\bmr-2\b/);

    const icon = item.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('size-3.5');
    expect(icon?.getAttribute('class')).toContain('text-chatroom-text-secondary');
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
  });
});
