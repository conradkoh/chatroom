import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentSourcePicker } from './AttachmentSourcePicker';
const desktop = vi.fn();
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop() }));
vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
  useVisualViewportOffsetTop: () => 0,
}));
describe('AttachmentSourcePicker', () => {
  beforeEach(() => desktop.mockReset());
  it('opens desktop picker and selects File', async () => {
    desktop.mockReturnValue(true);
    const file = vi.fn();
    render(
      <AttachmentSourcePicker
        trigger={<button>Add</button>}
        onPickFile={file}
        onPickSketch={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('File')).toBeInTheDocument();
    await userEvent.click(screen.getByText('File'));
    expect(file).toHaveBeenCalled();
  });
  it('opens mobile drawer and selects Sketch', async () => {
    desktop.mockReturnValue(false);
    const sketch = vi.fn();
    render(
      <AttachmentSourcePicker
        trigger={<button>Add</button>}
        onPickFile={vi.fn()}
        onPickSketch={sketch}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Sketch')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Sketch'));
    expect(sketch).toHaveBeenCalled();
  });
});
