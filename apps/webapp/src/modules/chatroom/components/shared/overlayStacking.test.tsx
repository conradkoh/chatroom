import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent } from '../ui/dialog';
import { OverlayPortalContainerProvider } from './overlayPortalContainer';
import { FixedModal, FixedModalContent } from '@/components/ui/fixed-modal';

describe('overlay stacking tiers', () => {
  it('Dialog auto-elevates to z-[100] inside parent portal context', () => {
    render(
      <OverlayPortalContainerProvider container={document.createElement('div')}>
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent data-testid="nested-dialog">Content</DialogContent>
        </Dialog>
      </OverlayPortalContainerProvider>
    );
    const content = screen.getByTestId('nested-dialog');
    expect(content.className).toContain('z-[100]');
    expect(content.className).not.toContain('z-50');
  });

  it('FixedModal auto-elevates to z-[100] inside parent portal context', () => {
    render(
      <OverlayPortalContainerProvider container={document.createElement('div')}>
        <FixedModal isOpen onClose={vi.fn()}>
          <FixedModalContent>
            <div>Content</div>
          </FixedModalContent>
        </FixedModal>
      </OverlayPortalContainerProvider>
    );
    const modal = document.querySelector('.chatroom-root');
    expect(modal).not.toBeNull();
    expect(modal!.className).toContain('z-[100]');
  });

  it('Dialog at page level uses z-50', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent data-testid="page-dialog">Content</DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId('page-dialog').className).toContain('z-50');
  });
});
