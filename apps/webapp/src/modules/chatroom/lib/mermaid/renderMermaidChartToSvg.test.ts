import { describe, expect, it, vi } from 'vitest';

import { renderMermaidChartToSvg } from './renderMermaidChartToSvg';

const render = vi.fn().mockResolvedValue({
  svg: '<svg viewBox="0 0 10 10"><path /></svg>',
});

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render,
  },
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('renderMermaidChartToSvg', () => {
  it('decodes HTML entities before passing chart source to mermaid', async () => {
    await renderMermaidChartToSvg('flowchart TD\nA --&gt; B');

    expect(render).toHaveBeenCalledWith(expect.any(String), 'flowchart TD\nA --> B');
  });
});
