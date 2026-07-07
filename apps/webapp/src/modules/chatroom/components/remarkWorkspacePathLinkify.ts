import type { Link, Parent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

import { splitTextOnWorkspacePaths } from '../workspace/utils/workspaceFileLink';

const SKIP_PARENT_TYPES = new Set(['link', 'inlineCode', 'code']);

function linkifyWorkspacePathsInTree(tree: Root): void {
  visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
    if (index == null || parent == null) return;
    if (SKIP_PARENT_TYPES.has(parent.type)) return;

    const parts = splitTextOnWorkspacePaths(node.value);
    if (parts.length === 1 && parts[0].type === 'text') return;

    const replacements = parts.map((part) =>
      part.type === 'link'
        ? ({ type: 'link', url: part.url, children: part.children } satisfies Link)
        : ({ type: 'text', value: part.value } satisfies Text)
    );

    parent.children.splice(index, 1, ...replacements);
  });
}

export const remarkWorkspacePathLinkify = () => linkifyWorkspacePathsInTree;
