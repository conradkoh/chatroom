import { render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useContainedSelectAll } from './useContainedSelectAll';

function TestComponent() {
  const ref = useRef<HTMLDivElement>(null);
  useContainedSelectAll(ref);
  return (
    <div ref={ref} tabIndex={-1} data-testid="container">
      Selectable text
    </div>
  );
}

describe('useContainedSelectAll', () => {
  let mockSelection: {
    removeAllRanges: ReturnType<typeof vi.fn>;
    addRange: ReturnType<typeof vi.fn>;
    anchorNode: Node | null;
  };
  let mockRange: { selectNodeContents: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRange = { selectNodeContents: vi.fn() };
    mockSelection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      anchorNode: null,
    };
    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as unknown as Range);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);
  });

  it('selects all content inside container on Cmd+A when focus is inside', () => {
    render(<TestComponent />);
    const container = document.querySelector('[data-testid="container"]');
    expect(container).not.toBeNull();

    // Focus the container
    (container as HTMLElement).focus();

    // Fire Cmd+A (capture phase listener on document)
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mockSelection.removeAllRanges).toHaveBeenCalled();
    expect(mockSelection.addRange).toHaveBeenCalled();
  });

  it('does not intercept Cmd+A when focus is outside container', () => {
    render(<TestComponent />);

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(mockSelection.removeAllRanges).not.toHaveBeenCalled();
  });

  it('does not intercept plain A key (no meta/ctrl)', () => {
    render(<TestComponent />);

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: false,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
