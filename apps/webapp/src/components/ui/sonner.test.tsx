import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Toaster } from './sonner';

const mockSonner = vi.fn((_props: Record<string, unknown>) => null);

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    mockSonner(props);
    return null;
  },
}));

describe('Toaster', () => {
  it('uses flex layout with close button at end of toast row', () => {
    mockSonner.mockClear();
    render(<Toaster />);

    expect(mockSonner).toHaveBeenCalledWith(
      expect.objectContaining({
        closeButton: true,
        toastOptions: {
          classNames: {
            toast: 'group toast !flex !w-full items-center gap-2',
            content: 'flex-1 min-w-0',
            closeButton:
              'sonner-close-button order-last !static shrink-0 !transform-none !h-5 !w-5 !rounded-none !border-0 !bg-transparent !text-muted-foreground hover:!bg-transparent hover:!text-foreground',
          },
        },
        style: expect.objectContaining({
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        }),
      })
    );
  });
});
