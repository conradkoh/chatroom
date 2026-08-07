import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { Command, CommandInput, CommandItem, CommandList } from './command';

import { fuzzyFilter } from '@/lib/fuzzyMatch';
import {
  CommandDialogContent,
  CommandDialogRoot,
} from '@/modules/chatroom/components/shared/CommandDialogContent';

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

  it('fires onSelect on pointer tap after search (touch path)', async () => {
    const user = userEvent.setup();
    const onSelectAlpha = vi.fn();
    const onSelectBeta = vi.fn();
    const onPointerDown = vi.fn();

    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <Command filter={fuzzyFilter}>
            <CommandInput placeholder="Search..." />
            <CommandList>
              <CommandItem
                value="alpha"
                keywords={['alpha']}
                onSelect={onSelectAlpha}
                onPointerDown={onPointerDown}
              >
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

    await user.type(screen.getByPlaceholderText('Search...'), 'alp');
    const alphaItem = await screen.findByText('Alpha');
    expect(screen.queryByText('Beta')).toBeNull();

    // pointerdown must preventDefault so the command input does not blur and
    // the item stays in the user-gesture stack for cmdk selection.
    fireEvent.pointerDown(alphaItem);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerDown.mock.calls[0]?.[0].defaultPrevented).toBe(true);

    // Simulate the rest of a pointer tap (pointerup → synthesized click).
    fireEvent.pointerUp(alphaItem);
    fireEvent.click(alphaItem);

    await waitFor(() => {
      expect(onSelectAlpha).toHaveBeenCalledTimes(1);
    });
    expect(onSelectBeta).not.toHaveBeenCalled();
  });

  it('fires onSelect on touch tap after search', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onTouchStart = vi.fn();

    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <Command filter={fuzzyFilter}>
            <CommandInput placeholder="Search..." />
            <CommandList>
              <CommandItem
                value="alpha"
                keywords={['alpha']}
                onSelect={onSelect}
                onTouchStart={onTouchStart}
              >
                Alpha
              </CommandItem>
            </CommandList>
          </Command>
        </CommandDialogContent>
      </Dialog>
    );

    await user.type(screen.getByPlaceholderText('Search...'), 'alp');
    const alphaItem = await screen.findByText('Alpha');

    // touchstart must preventDefault (belt-and-suspenders before pointerdown).
    fireEvent.touchStart(alphaItem);
    expect(onTouchStart).toHaveBeenCalledTimes(1);
    expect(onTouchStart.mock.calls[0]?.[0].defaultPrevented).toBe(true);

    // Simulate the rest of a touch tap (touchend → synthesized click).
    fireEvent.touchEnd(alphaItem);
    fireEvent.click(alphaItem);

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  it('fires onSelect with controlled open state via CommandDialogRoot (no spurious dismiss)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <CommandDialogRoot
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          <CommandDialogContent open={open}>
            <Command filter={fuzzyFilter}>
              <CommandInput placeholder="Search..." />
              <CommandList>
                <CommandItem
                  value="alpha"
                  keywords={['alpha']}
                  onSelect={() => {
                    onSelect();
                    setOpen(false);
                  }}
                >
                  Alpha
                </CommandItem>
                <CommandItem value="beta" keywords={['beta']} onSelect={vi.fn()}>
                  Beta
                </CommandItem>
              </CommandList>
            </Command>
          </CommandDialogContent>
        </CommandDialogRoot>
      );
    }

    render(<Harness />);
    await user.type(screen.getByPlaceholderText('Search...'), 'alp');
    await user.click(await screen.findByText('Alpha'));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
    // Base UI must not spuriously dismiss before cmdk onSelect (would call onOpenChange(false) first).
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
