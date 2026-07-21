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
  it('positions the close button inline on the right with theme-aware styling', () => {
    mockSonner.mockClear();
    render(<Toaster />);

    expect(mockSonner).toHaveBeenCalledWith(
      expect.objectContaining({
        closeButton: true,
        toastOptions: {
          classNames: {
            toast: 'group toast items-center gap-2',
            closeButton:
              'static ml-auto shrink-0 !transform-none h-5 w-5 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
          },
        },
        style: expect.objectContaining({
          '--toast-close-button-start': 'unset',
          '--toast-close-button-end': 'unset',
          '--toast-close-button-transform': 'none',
        }),
      })
    );
  });
});
