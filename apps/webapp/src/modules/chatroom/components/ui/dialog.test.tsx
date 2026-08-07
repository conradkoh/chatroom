import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogScrollBody,
  DialogTrigger,
  stripOverflowFromClassName,
} from './dialog';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import {
  chatroomIndustrialFloatingModalContentClassName,
  chatroomIndustrialModalContentClassName,
} from '../shared/industrialDialogStyles';
import { OverlayPortalContainerProvider } from '../shared/overlayPortalContainer';

import { cn } from '@/lib/utils';

function tokens(className: string) {
  return className.split(/\s+/).filter(Boolean);
}

describe('stripOverflowFromClassName', () => {
  it('removes overflow utilities', () => {
    expect(stripOverflowFromClassName('max-w-2xl overflow-y-auto overflow-x-hidden')).toBe(
      'max-w-2xl'
    );
  });
});

describe('DialogContent z-index', () => {
  it('renders with z-50 (unified z-index band)', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent data-testid="dialog-content">Content</DialogContent>
      </Dialog>
    );

    const content = screen.getByTestId('dialog-content');
    expect(content.className).toContain('z-50');
  });

  it('provides overlay portal container for nested pickers', () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogTrigger />
        <DialogContent data-testid="dialog-content">
          <div data-testid="dialog-child">Content</div>
        </DialogContent>
      </Dialog>
    );

    expect(screen.getByTestId('dialog-child')).toBeInTheDocument();
    const content = screen.getByTestId('dialog-content');
    expect(content).toContainElement(screen.getByTestId('dialog-child'));
  });

  it('strips overflow from Content className', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent data-testid="dialog-content" className="overflow-y-auto max-w-lg">
          body
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId('dialog-content');
    expect(content.className).not.toMatch(/overflow-y-auto/);
    expect(content.className).toContain('overflow-visible');
  });

  it('renders portal host element', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>body</DialogContent>
      </Dialog>
    );
    expect(document.querySelector('[data-slot="chatroom-dialog-portal-host"]')).not.toBeNull();
  });

  it('portals popover under portal-host, not inside scroll body', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogScrollBody>
            <Popover open onOpenChange={vi.fn()}>
              <PopoverTrigger type="button">open</PopoverTrigger>
              <PopoverContent data-testid="popover-content">panel</PopoverContent>
            </Popover>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    );
    const popover = screen.getByTestId('popover-content');
    const host = document.querySelector('[data-slot="chatroom-dialog-portal-host"]');
    expect(host).not.toBeNull();
    expect(host).toContainElement(popover);
    // Popover must not be descendant of scroll body
    const scrollBody = document.querySelector('[data-slot="chatroom-dialog-scroll-body"]');
    expect(scrollBody).not.toBeNull();
    expect(scrollBody).not.toContainElement(popover);
  });

  it('renders floating content with z-[100] above base modal band', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent floating data-testid="floating-dialog">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('floating-dialog').className).toContain('z-[100]');
  });

  it('auto-elevates to z-[100] when nested in portal context', () => {
    render(
      <OverlayPortalContainerProvider container={document.createElement('div')}>
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent data-testid="nested-dialog">Content</DialogContent>
        </Dialog>
      </OverlayPortalContainerProvider>
    );
    expect(screen.getByTestId('nested-dialog').className).toContain('z-[100]');
  });
});

describe('DialogContent className merge', () => {
  it('preserves fixed and grid when suffix is overflow-visible only', () => {
    const merged = cn(chatroomIndustrialModalContentClassName, 'max-w-2xl', 'overflow-visible');
    const t = tokens(merged);
    expect(t).toContain('fixed');
    expect(t).toContain('grid');
    expect(t).not.toContain('relative');
  });

  it('preserves fixed on floating industrial classes', () => {
    const merged = cn(chatroomIndustrialFloatingModalContentClassName, 'overflow-visible');
    const t = tokens(merged);
    expect(t).toContain('fixed');
    expect(t).not.toContain('relative');
  });

  it('documents regression: relative flex flex-col strips fixed and grid', () => {
    const merged = cn(
      chatroomIndustrialModalContentClassName,
      'overflow-visible relative flex flex-col'
    );
    const t = tokens(merged);
    expect(t).not.toContain('fixed');
    expect(t).not.toContain('grid');
    expect(t).toContain('relative');
  });

  it('consumer flex flex-col overrides grid but preserves fixed', () => {
    const merged = cn(
      chatroomIndustrialModalContentClassName,
      'max-w-2xl max-h-[85vh] flex flex-col min-w-0',
      'overflow-visible'
    );
    const t = tokens(merged);
    expect(t).toContain('fixed');
    expect(t).toContain('flex');
    expect(t).not.toContain('grid');
    expect(t).not.toContain('relative');
  });
});
