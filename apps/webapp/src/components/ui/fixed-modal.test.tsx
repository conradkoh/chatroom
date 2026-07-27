import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalSidebar,
  FixedModalTitle,
} from './fixed-modal';

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

describe('FixedModal sidebar layout', () => {
  it('places sidebar before content as direct dialog descendants', () => {
    render(
      <FixedModal isOpen onClose={() => undefined} maxWidth="max-w-5xl">
        <FixedModalSidebar>
          <FixedModalHeader>
            <FixedModalTitle>Nav</FixedModalTitle>
          </FixedModalHeader>
        </FixedModalSidebar>
        <FixedModalContent>
          <FixedModalBody>Body</FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    );

    const dialog = screen.getByRole('dialog');
    const sidebar = dialog.querySelector('[data-slot="fixed-modal-sidebar"]');
    const content = dialog.querySelector('[data-slot="fixed-modal-content"]');

    expect(sidebar).not.toBeNull();
    expect(content).not.toBeNull();
    // Sidebar precedes content in DOM (horizontal row layout contract)
    expect(
      sidebar!.compareDocumentPosition(content!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders content-only modal without sidebar slot', () => {
    render(
      <FixedModal isOpen onClose={() => undefined}>
        <FixedModalContent>
          <FixedModalBody>Only content</FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-slot="fixed-modal-content"]')).not.toBeNull();
    expect(dialog.querySelector('[data-slot="fixed-modal-sidebar"]')).toBeNull();
  });
});
