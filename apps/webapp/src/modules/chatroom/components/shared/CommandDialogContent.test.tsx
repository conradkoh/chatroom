import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CommandDialogContent } from './CommandDialogContent';

import { Command, CommandInput } from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';

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
    expect(backdrop?.className).toContain('fixed');
    expect(backdrop?.className).toContain('inset-0');
    expect(backdrop?.className).toContain('bg-transparent');
  });
});

describe('CommandDialogContent surface', () => {
  it('renders a plain dialog surface with aria-modal false', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    const surface = screen.getByTestId('content');
    expect(surface).toHaveAttribute('role', 'dialog');
    expect(surface).toHaveAttribute('aria-modal', 'false');
    expect(surface.tagName).toBe('DIV');
  });

  it('wires aria-labelledby and aria-describedby from DialogTitle and DialogDescription', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <DialogDescription className="sr-only">Search and execute a command</DialogDescription>
          body
        </CommandDialogContent>
      </Dialog>
    );

    const surface = screen.getByTestId('content');
    const titleId = screen.getByText('Command Palette').id;
    const descriptionId = screen.getByText('Search and execute a command').id;
    expect(surface).toHaveAttribute('aria-labelledby', titleId);
    expect(surface).toHaveAttribute('aria-describedby', descriptionId);
  });

  it('is not hidden on the first render when reopening after close', () => {
    const { rerender } = render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    rerender(
      <Dialog open={false} onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open={false} data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    const surface = screen.getByTestId('content');
    surface.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true }));

    rerender(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('content')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('content')).toHaveAttribute('data-open');
  });

  it('does not add data-base-ui-inert markers to body children when opening', () => {
    render(
      <div data-testid="page-chrome">
        <button type="button">Outside</button>
      </div>
    );
    const beforeCount = document.body.querySelectorAll('[data-base-ui-inert]').length;

    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <CommandDialogContent open>
          <DialogTitle className="sr-only">Test</DialogTitle>
          dialog body
        </CommandDialogContent>
      </Dialog>
    );
    const afterCount = document.body.querySelectorAll('[data-base-ui-inert]').length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('CommandDialogContent input focus', () => {
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

    const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(input).not.toBeNull();
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
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
    }).not.toThrow();
  });
});
