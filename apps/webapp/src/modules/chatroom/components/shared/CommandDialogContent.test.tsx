import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CommandDialogContent } from './CommandDialogContent';

import { Command, CommandInput } from '@/components/ui/command';

const Dialog = DialogPrimitive.Root;

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

describe('CommandDialogContent dismiss backdrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders backdrop when open and omits it when closed', () => {
    const { rerender } = render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    vi.advanceTimersByTime(0);
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).not.toBeNull();

    rerender(
      <Dialog open={false} onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open={false} data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).toBeNull();
  });

  it('backdrop is z-40; content is z-50', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    vi.advanceTimersByTime(0);
    const backdrop = document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]');
    expect(backdrop?.className).toContain('z-40');
    expect(screen.getByTestId('content').className).toContain('z-50');
  });

  it('backdrop covers the full viewport so outside pointer events are intercepted', () => {
    const onOpenChange = vi.fn();
    render(
      <div>
        <button type="button" data-testid="underlying">
          beneath
        </button>
        <Dialog open onOpenChange={onOpenChange} modal={false}>
          <CommandDialogContent open>
            <DialogPrimitive.Title className="sr-only">Test</DialogPrimitive.Title>
            dialog body
          </CommandDialogContent>
        </Dialog>
      </div>
    );
    vi.advanceTimersByTime(0);

    const backdrop = document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]');
    expect(backdrop).not.toBeNull();
    // Full-viewport coverage — a real tap lands on the backdrop, never the
    // underlying page element, so the element's onClick is not triggered.
    expect(backdrop?.className).toContain('fixed');
    expect(backdrop?.className).toContain('inset-0');
    expect(backdrop?.className).toContain('bg-transparent');
  });
});

describe('CommandDialogContent input focus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('focuses the command input when the dialog opens', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <Command>
            <CommandInput placeholder="Search..." />
          </Command>
        </CommandDialogContent>
      </Dialog>
    );
    vi.advanceTimersByTime(0);

    const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(input).not.toBeNull();
    expect(input).toHaveFocus();
  });

  it('does not throw when no command input is present', () => {
    expect(() => {
      render(
        <Dialog open onOpenChange={vi.fn()} modal={false}>
          <CommandDialogContent open data-testid="content">
            dialog body
          </CommandDialogContent>
        </Dialog>
      );
      vi.advanceTimersByTime(0);
    }).not.toThrow();
  });
});
