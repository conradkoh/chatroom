import type { Root } from 'mdast';
import { describe, expect, it } from 'vitest';

import { remarkWorkspacePathLinkify } from './remarkWorkspacePathLinkify';

function runPlugin(tree: Root): Root {
  remarkWorkspacePathLinkify()(tree);
  return tree;
}

describe('remarkWorkspacePathLinkify', () => {
  it('linkifies bare workspace paths in paragraph text', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'See apps/webapp/src/foo.ts for details' }],
        },
      ],
    };

    runPlugin(tree);

    const paragraph = tree.children[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type !== 'paragraph') return;

    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]).toEqual({ type: 'text', value: 'See ' });
    expect(paragraph.children[1]).toEqual({
      type: 'link',
      url: 'apps/webapp/src/foo.ts',
      children: [{ type: 'text', value: 'apps/webapp/src/foo.ts' }],
    });
    expect(paragraph.children[2]).toEqual({ type: 'text', value: ' for details' });
  });

  it('does not linkify paths inside fenced code blocks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'typescript',
          value: 'import from apps/webapp/src/foo.ts',
        },
      ],
    };

    runPlugin(tree);

    expect(tree.children[0]).toEqual({
      type: 'code',
      lang: 'typescript',
      value: 'import from apps/webapp/src/foo.ts',
    });
  });

  it('does not double-wrap existing markdown links', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'apps/webapp/src/foo.ts',
              children: [{ type: 'text', value: 'apps/webapp/src/foo.ts' }],
            },
          ],
        },
      ],
    };

    runPlugin(tree);

    const paragraph = tree.children[0];
    if (paragraph.type !== 'paragraph') return;
    expect(paragraph.children).toHaveLength(1);
    expect(paragraph.children[0].type).toBe('link');
  });

  it('does not linkify paths inside inline code', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Run ' },
            {
              type: 'inlineCode',
              value: 'apps/webapp/src/foo.ts',
            },
          ],
        },
      ],
    };

    runPlugin(tree);

    const paragraph = tree.children[0];
    if (paragraph.type !== 'paragraph') return;
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[1].type).toBe('inlineCode');
  });
});
