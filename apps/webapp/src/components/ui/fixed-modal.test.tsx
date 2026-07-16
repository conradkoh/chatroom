import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixedModal } from './fixed-modal';

import { Popover, PopoverContent, PopoverTrigger } from '@/modules/chatroom/components/ui/popover';

describe('FixedModal', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('later-opened modal appears after first in DOM (portal stacking)', () => {
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
    expect(overlays[0]?.compareDocumentPosition(overlays[1]!)).toBe(4);
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

  it('closes only the top modal on escape when stacked', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();

    render(
      <>
        <FixedModal isOpen onClose={parentClose}>
          <div>List</div>
        </FixedModal>
        <FixedModal isOpen onClose={childClose}>
          <div>Detail</div>
        </FixedModal>
      </>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
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

  it('keeps correct stacking order when parent onClose identity changes while child opens', () => {
    const Wrapper = () => {
      const [, forceRender] = useState(0);
      const [detailOpen, setDetailOpen] = useState(false);
      return (
        <>
          <FixedModal isOpen onClose={() => forceRender((n) => n + 1)}>
            <button type="button" onClick={() => setDetailOpen(true)}>
              open detail
            </button>
          </FixedModal>
          {detailOpen && (
            <FixedModal isOpen onClose={() => setDetailOpen(false)}>
              <div>Detail</div>
            </FixedModal>
          )}
        </>
      );
    };
    render(<Wrapper />);
    fireEvent.click(screen.getByText('open detail'));
    const overlays = document.body.querySelectorAll<HTMLElement>('.fixed.inset-0');
    expect(overlays).toHaveLength(2);
    expect(overlays[0]?.compareDocumentPosition(overlays[1]!)).toBe(4);
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
