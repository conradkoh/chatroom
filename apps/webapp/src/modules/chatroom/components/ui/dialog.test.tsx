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
              <PopoverTrigger asChild>
                <button type="button">open</button>
              </PopoverTrigger>
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
});
