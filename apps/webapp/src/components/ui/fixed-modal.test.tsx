import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixedModal } from './fixed-modal';

import { Popover, PopoverContent, PopoverTrigger } from '@/modules/chatroom/components/ui/popover';

describe('FixedModal', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('assigns higher z-index to later-opened modals', () => {
    render(
      <>
        <FixedModal isOpen onClose={() => undefined}>
          <div>First modal</div>
        </FixedModal>
        <FixedModal isOpen onClose={() => undefined}>
          <div>Second modal</div>
        </FixedModal>
      </>
    );

    const overlays = document.body.querySelectorAll<HTMLElement>('.fixed.inset-0');
    expect(overlays).toHaveLength(2);
    expect(Number(overlays[0]?.style.zIndex)).toBeLessThan(Number(overlays[1]?.style.zIndex));
  });

  it('keeps body scroll locked until all modals close', () => {
    const view = render(
      <FixedModal isOpen onClose={() => undefined}>
        <div>First modal</div>
      </FixedModal>
    );

    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <>
        <FixedModal isOpen onClose={() => undefined}>
          <div>First modal</div>
        </FixedModal>
        <FixedModal isOpen onClose={() => undefined}>
          <div>Second modal</div>
        </FixedModal>
      </>
    );

    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <FixedModal isOpen onClose={() => undefined}>
        <div>Second modal</div>
      </FixedModal>
    );

    expect(document.body.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders modal content when open', () => {
    render(
      <FixedModal isOpen onClose={() => undefined}>
        <div>Modal content</div>
      </FixedModal>
    );

    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('closes on escape when no portaled menu is above it', () => {
    const onClose = vi.fn();

    render(
      <FixedModal isOpen onClose={onClose}>
        <div>Modal content</div>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on escape when a portaled popover is open above it', () => {
    const onClose = vi.fn();
    const onPopoverOpenChange = vi.fn();

    const view = render(
      <FixedModal isOpen onClose={onClose}>
        <Popover open onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <button type="button">open picker</button>
          </PopoverTrigger>
          <PopoverContent>picker panel</PopoverContent>
        </Popover>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(
      <FixedModal isOpen onClose={onClose}>
        <Popover open={false} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <button type="button">open picker</button>
          </PopoverTrigger>
          <PopoverContent>picker panel</PopoverContent>
        </Popover>
      </FixedModal>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
