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
  it('enables a pointer-styled close button on every toast', () => {
    mockSonner.mockClear();
    render(<Toaster />);

    expect(mockSonner).toHaveBeenCalledWith(
      expect.objectContaining({
        closeButton: true,
        toastOptions: {
          classNames: {
            closeButton: 'cursor-pointer',
          },
        },
      })
    );
  });
});
