import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SketchLayersPanel } from './SketchLayersPanel';

const layers = [
  { id: 'paint', name: 'Drawing 1', kind: 'paint' as const, hasContent: false },
  { id: 'paste', name: 'Pasted image 1', kind: 'pasted-image' as const, hasContent: false },
];
describe('SketchLayersPanel', () => {
  it('renders supplied top-first order and active state', () => {
    render(
      <SketchLayersPanel
        layersTopFirst={[layers[1], layers[0]]}
        activeLayerId="paint"
        disabled={false}
        onActiveLayerChange={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Pasted image 1');
    expect(screen.getByRole('button', { name: /Drawing 1/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
  it('switches inactive layers', async () => {
    const change = vi.fn();
    render(
      <SketchLayersPanel
        layersTopFirst={layers}
        activeLayerId="paint"
        disabled={false}
        onActiveLayerChange={change}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Pasted image/ }));
    expect(change).toHaveBeenCalledWith('paste');
  });
  it('does not switch when disabled', async () => {
    const change = vi.fn();
    render(
      <SketchLayersPanel
        layersTopFirst={layers}
        activeLayerId="paint"
        disabled
        onActiveLayerChange={change}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Pasted image/ }));
    expect(change).not.toHaveBeenCalled();
  });
});
