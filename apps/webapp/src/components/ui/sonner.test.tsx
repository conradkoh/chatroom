import { render } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import { Toaster } from './sonner';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Toaster', () => {
  it('renders without crashing', () => {
    render(<Toaster />);
  });
});
