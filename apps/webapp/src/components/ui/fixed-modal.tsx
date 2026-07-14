'use client';

import { X } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, memo, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import {
  isTopOverlayDismiss,
  popOverlayDismiss,
  pushOverlayDismiss,
} from '@/modules/chatroom/components/shared/overlayDismissStack';

// ─── Modal Stack ─────────────────────────────────────────────────────────────
// Tracks open FixedModals so only the topmost modal responds to Escape.
let modalStack: (() => void)[] = [];

// Reference-counted body scroll lock for nested/stacked modals.
let scrollLockCount = 0;
let savedBodyOverflow: string | null = null;

const BASE_MODAL_Z_INDEX = 50;
const MODAL_Z_INDEX_STEP = 10;

// ─── Composition Sub-Components ─────────────────────────────────────────

/**
 * Header bar for the fixed modal.
 * Container for title, actions, and close button.
 *
 * ```tsx
 * <FixedModalHeader onClose={onClose}>
 *   <FixedModalTitle>Settings</FixedModalTitle>
 * </FixedModalHeader>
 * ```
 */
function FixedModalHeader({
  className,
  children,
  onClose,
  ...props
}: React.ComponentProps<'div'> & {
  /** Called when the close button is clicked. If omitted, no close button is shown. */
  onClose?: () => void;
}) {
  return (
    <div
      data-slot="fixed-modal-header"
      className={cn(
        'flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0',
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0 min-h-8 flex items-center">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
        >
          <X size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Title text for the fixed modal header.
 * Renders as an `<h2>` with consistent chatroom styling.
 *
 * ```tsx
 * <FixedModalHeader onClose={onClose}>
 *   <FixedModalTitle>All Agents (3)</FixedModalTitle>
 * </FixedModalHeader>
 * ```
 */
function FixedModalTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="fixed-modal-title"
      className={cn(
        'text-sm font-bold uppercase tracking-wider text-chatroom-text-primary',
        className
      )}
      {...props}
    />
  );
}

/**
 * Content column for the fixed modal.
 * Wraps header + body in a vertical flex container. Required when using
 * `FixedModalHeader` and `FixedModalBody` as the root uses `flex` (row).
 *
 * ```tsx
 * <FixedModal>
 *   <FixedModalContent>
 *     <FixedModalHeader onClose={onClose}>
 *       <FixedModalTitle>Title</FixedModalTitle>
 *     </FixedModalHeader>
 *     <FixedModalBody>Content</FixedModalBody>
 *   </FixedModalContent>
 * </FixedModal>
 * ```
 */
function FixedModalContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="fixed-modal-content"
      className={cn('flex-1 flex flex-col min-w-0 min-h-0', className)}
      {...props}
    />
  );
}

/**
 * Scrollable body area for the fixed modal.
 * Content that overflows will scroll vertically.
 *
 * ```tsx
 * <FixedModalBody>
 *   <div className="p-6">Long content here...</div>
 * </FixedModalBody>
 * ```
 */
function FixedModalBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="fixed-modal-body"
      className={cn('flex-1 overflow-y-auto min-h-0', className)}
      {...props}
    />
  );
}

/**
 * Optional sidebar for the fixed modal (e.g. navigation tabs).
 * Renders as a flex-shrink-0 column on the left side of the modal.
 *
 * ```tsx
 * <FixedModalSidebar className="w-48">
 *   <nav>...</nav>
 * </FixedModalSidebar>
 * ```
 */
function FixedModalSidebar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="fixed-modal-sidebar"
      className={cn(
        'flex-shrink-0 bg-chatroom-bg-surface border-r-2 border-chatroom-border-strong flex flex-col',
        className
      )}
      {...props}
    />
  );
}

// ─── Root Component ─────────────────────────────────────────────────────

interface FixedModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Called when the modal should close (backdrop click, escape key) */
  onClose: () => void;
  /** Modal content — compose with FixedModalHeader, FixedModalBody, FixedModalSidebar */
  children: React.ReactNode;
  /**
   * Maximum width class for the modal.
   * @default "max-w-lg"
   */
  maxWidth?: string;
  /** Additional className for the modal panel */
  className?: string;
  /**
   * When false, clicking the backdrop does not call `onClose` (escape still does).
   * @default true
   */
  closeOnBackdrop?: boolean;
}

/**
 * A fixed-size modal with composition-based sub-components.
 *
 * Follows the ShadCN/MUI composition pattern — compose the modal layout
 * using `FixedModalHeader`, `FixedModalBody`, and `FixedModalSidebar`.
 *
 * Features:
 * - Fixed height: 70vh on desktop, full screen on mobile
 * - Scrollable content area (via FixedModalBody)
 * - Backdrop click and Escape key to close (backdrop optional via `closeOnBackdrop`)
 * - Body scroll lock while open
 *
 * ### Simple modal (header + scrollable content):
 * ```tsx
 * <FixedModal isOpen={isOpen} onClose={onClose}>
 *   <FixedModalContent>
 *     <FixedModalHeader onClose={onClose}>
 *       <FixedModalTitle>Title</FixedModalTitle>
 *     </FixedModalHeader>
 *     <FixedModalBody>
 *       <div className="p-4">Content here</div>
 *     </FixedModalBody>
 *   </FixedModalContent>
 * </FixedModal>
 * ```
 *
 * ### Modal with sidebar:
 * ```tsx
 * <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
 *   <FixedModalSidebar className="w-48">
 *     <nav>...</nav>
 *   </FixedModalSidebar>
 *   <FixedModalContent>
 *     <FixedModalHeader onClose={onClose}>
 *       <FixedModalTitle>Tab Title</FixedModalTitle>
 *     </FixedModalHeader>
 *     <FixedModalBody>
 *       <div className="p-6">Tab content</div>
 *     </FixedModalBody>
 *   </FixedModalContent>
 * </FixedModal>
 * ```
 */
const FixedModal = memo(function FixedModal({
  isOpen,
  onClose,
  children,
  maxWidth = 'max-w-lg',
  className,
  closeOnBackdrop = true,
}: FixedModalProps) {
  const [layerZIndex, setLayerZIndex] = useState(BASE_MODAL_Z_INDEX);

  // Lock body scroll when modal is open (reference-counted for stacked modals)
  useEffect(() => {
    if (!isOpen) return;

    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLockCount++;

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0 && savedBodyOverflow !== null) {
        document.body.style.overflow = savedBodyOverflow;
        savedBodyOverflow = null;
      }
    };
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && closeOnBackdrop) {
        onClose();
      }
    },
    [onClose, closeOnBackdrop]
  );

  // Register dismiss handler before portaled menu useEffects run (child effects follow parent layout).
  useLayoutEffect(() => {
    if (!isOpen) return;

    const handler = onClose;
    pushOverlayDismiss(handler);
    return () => popOverlayDismiss(handler);
  }, [isOpen, onClose]);

  // Handle Escape key — only the topmost overlay responds
  useEffect(() => {
    if (!isOpen) return;

    const handler = onClose;
    modalStack.push(handler);
    setLayerZIndex(BASE_MODAL_Z_INDEX + modalStack.length * MODAL_Z_INDEX_STEP);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlayDismiss(handler)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      modalStack = modalStack.filter((h) => h !== handler);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{ zIndex: layerZIndex }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'chatroom-root w-full flex bg-chatroom-bg-primary border-0 sm:border-2 border-chatroom-border-strong overflow-hidden',
          // Full screen on mobile, fixed 70vh on desktop
          'h-full sm:h-[70vh]',
          maxWidth,
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
});

export {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
};
