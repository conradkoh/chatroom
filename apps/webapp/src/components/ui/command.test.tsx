import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { Command, CommandInput, CommandItem, CommandList } from './command';

import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { CommandDialogContent } from '@/modules/chatroom/components/shared/CommandDialogContent';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const Dialog = DialogPrimitive.Root;

describe('CommandItem click after search', () => {
  it('fires onSelect when clicking a filtered item', async () => {
    const user = userEvent.setup();
    const onSelectAlpha = vi.fn();
    const onSelectBeta = vi.fn();

    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <Command filter={fuzzyFilter}>
            <CommandInput placeholder="Search..." />
            <CommandList>
              <CommandItem value="alpha" keywords={['alpha']} onSelect={onSelectAlpha}>
                Alpha
              </CommandItem>
              <CommandItem value="beta" keywords={['beta']} onSelect={onSelectBeta}>
                Beta
              </CommandItem>
            </CommandList>
          </Command>
        </CommandDialogContent>
      </Dialog>
    );

    await user.click(screen.getByPlaceholderText('Search...'));
    await user.type(screen.getByPlaceholderText('Search...'), 'alp');

    const alphaItem = await screen.findByText('Alpha');
    expect(screen.queryByText('Beta')).toBeNull();

    await user.click(alphaItem);

    await waitFor(() => {
      expect(onSelectAlpha).toHaveBeenCalledTimes(1);
    });
    expect(onSelectBeta).not.toHaveBeenCalled();
  });

  it('fires onSelect via Enter on filtered item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <Command filter={fuzzyFilter}>
            <CommandInput placeholder="Search..." />
            <CommandList>
              <CommandItem value="alpha" keywords={['alpha']} onSelect={onSelect}>
                Alpha
              </CommandItem>
            </CommandList>
          </Command>
        </CommandDialogContent>
      </Dialog>
    );

    await user.type(screen.getByPlaceholderText('Search...'), 'alp');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });
});
