import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CommandDialogContent, CommandDialogRoot } from './CommandDialogContent';

import { Command, CommandInput } from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

describe('CommandDialogRoot', () => {
  it('defaults to modal false and disables Base UI pointer dismissal', () => {
    const onOpenChange = vi.fn();
    render(
      <CommandDialogRoot open onOpenChange={onOpenChange}>
        <CommandDialogContent open data-testid="content">
          <button type="button">inside</button>
        </CommandDialogContent>
      </CommandDialogRoot>
    );

    const inside = screen.getByRole('button', { name: 'inside' });
    inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    inside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    inside.click();

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not allow callers to override modal or disablePointerDismissal', () => {
    const onOpenChange = vi.fn();
    render(
      // @ts-expect-error modal and disablePointerDismissal are not overridable props
      <CommandDialogRoot open onOpenChange={onOpenChange} modal disablePointerDismissal={false}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
  });
});

describe('CommandDialogContent dismiss backdrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders backdrop when open and omits it when closed', () => {
    const { rerender } = render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    vi.advanceTimersByTime(0);
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).not.toBeNull();

    rerender(
      <CommandDialogRoot open={false} onOpenChange={vi.fn()}>
        <CommandDialogContent open={false} data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).toBeNull();
  });

  it('backdrop is z-40; content is z-50', () => {
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
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
        <CommandDialogRoot open onOpenChange={onOpenChange}>
          <CommandDialogContent open>
            <DialogTitle className="sr-only">Test</DialogTitle>
            dialog body
          </CommandDialogContent>
        </CommandDialogRoot>
      </div>
    );
    vi.advanceTimersByTime(0);

    const backdrop = document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.className).toContain('fixed');
    expect(backdrop?.className).toContain('inset-0');
    expect(backdrop?.className).toContain('bg-transparent');
  });

  it('calls onBackdropDismiss when backdrop is pressed', () => {
    const onBackdropDismiss = vi.fn();
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open onBackdropDismiss={onBackdropDismiss}>
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );

    const backdrop = document.querySelector<HTMLElement>(
      '[data-slot="command-dialog-dismiss-backdrop"]'
    );
    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(onBackdropDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onBackdropDismiss for non-primary buttons', () => {
    const onBackdropDismiss = vi.fn();
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open onBackdropDismiss={onBackdropDismiss}>
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );

    const backdrop = document.querySelector<HTMLElement>(
      '[data-slot="command-dialog-dismiss-backdrop"]'
    );
    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(onBackdropDismiss).not.toHaveBeenCalled();
  });
});

describe('CommandDialogContent surface', () => {
  it('renders a plain dialog surface with aria-modal false', () => {
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    const surface = screen.getByTestId('content');
    expect(surface).toHaveAttribute('role', 'dialog');
    expect(surface).toHaveAttribute('aria-modal', 'false');
    expect(surface.tagName).toBe('DIV');
  });

  it('wires aria-labelledby and aria-describedby from DialogTitle and DialogDescription', () => {
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <DialogDescription className="sr-only">Search and execute a command</DialogDescription>
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );

    const surface = screen.getByTestId('content');
    const titleId = screen.getByText('Command Palette').id;
    const descriptionId = screen.getByText('Search and execute a command').id;
    expect(surface).toHaveAttribute('aria-labelledby', titleId);
    expect(surface).toHaveAttribute('aria-describedby', descriptionId);
  });

  it('is not hidden on the first render when reopening after close', () => {
    const { rerender } = render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    rerender(
      <CommandDialogRoot open={false} onOpenChange={vi.fn()}>
        <CommandDialogContent open={false} data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    rerender(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    expect(screen.getByTestId('content')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('content')).toHaveAttribute('data-open');
  });

  it('surface has no animation utility classes', () => {
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open data-testid="content">
          body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    const className = screen.getByTestId('content').className;
    expect(className).not.toContain('animate-out');
    expect(className).not.toContain('fade-out');
  });

  it('does not add data-base-ui-inert markers to body children when opening', () => {
    render(
      <div data-testid="page-chrome">
        <button type="button">Outside</button>
      </div>
    );
    const beforeCount = document.body.querySelectorAll('[data-base-ui-inert]').length;

    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open>
          <DialogTitle className="sr-only">Test</DialogTitle>
          dialog body
        </CommandDialogContent>
      </CommandDialogRoot>
    );
    const afterCount = document.body.querySelectorAll('[data-base-ui-inert]').length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('CommandDialogContent input focus', () => {
  it('focuses the command input when the dialog opens', async () => {
    render(
      <CommandDialogRoot open onOpenChange={vi.fn()}>
        <CommandDialogContent open>
          <Command>
            <CommandInput placeholder="Search..." />
          </Command>
        </CommandDialogContent>
      </CommandDialogRoot>
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
        <CommandDialogRoot open onOpenChange={vi.fn()}>
          <CommandDialogContent open data-testid="content">
            dialog body
          </CommandDialogContent>
        </CommandDialogRoot>
      );
    }).not.toThrow();
  });
});
