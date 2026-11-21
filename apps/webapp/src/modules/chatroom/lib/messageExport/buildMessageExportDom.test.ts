import { describe, expect, it, vi } from 'vitest';

import { buildMessageExportDom } from './buildMessageExportDom';

vi.mock('./replaceMermaidFencesWithSvg', () => ({
  MERMAID_EXPORT_PLACEHOLDER_PREFIX: 'MERMAID_EXPORT_PLACEHOLDER_',
  replaceMermaidFencesWithSvg: vi.fn(() =>
    Promise.resolve({
      markdown: 'Intro\n\nMERMAID_EXPORT_PLACEHOLDER_0\n\n',
      diagrams: new Map([[0, '<svg id="diagram"></svg>']]),
    })
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => `<div>${children}</div>`,
}));

const message = {
  _id: 'msg-1',
  type: 'message' as const,
  senderRole: 'user',
  content: 'Intro\n\n```mermaid\ngraph TD; A-->B\n```',
  _creationTime: 1_700_000_000_000,
};

describe('buildMessageExportDom', () => {
  it('replaces the Mermaid placeholder with the rendered SVG wrapped in an export-diagram div', async () => {
    const { htmlFragment } = await buildMessageExportDom(message as never, '');

    expect(htmlFragment).toContain('<div class="export-diagram"');
    expect(htmlFragment).toContain('<svg id="diagram"></svg>');
    expect(htmlFragment).not.toContain('MERMAID_EXPORT_PLACEHOLDER_');
  });

  it('applies the caller root style first, then the light export theme, and returns a detached root', async () => {
    const { root } = await buildMessageExportDom(message as never, 'position:fixed;left:-9999px;');

    expect(root.isConnected).toBe(false);
    expect(root.style.position).toBe('fixed');
    expect(root.style.getPropertyValue('--chatroom-text-primary')).toBe('#171717');
    expect(root.textContent).toContain('Intro');
  });
});
