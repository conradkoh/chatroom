import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const mockTreeJson = JSON.stringify({
  entries: [
    { path: 'src/index.ts', type: 'file', size: 100, mtimeMs: 0 },
    { path: 'src/utils/helpers.ts', type: 'file', size: 200, mtimeMs: 0 },
    { path: 'package.json', type: 'file', size: 50, mtimeMs: 0 },
  ],
});

vi.mock('@/modules/chatroom/workspace/files', () => ({
  useWorkspaceFileTree: () => ({
    treeJson: mockTreeJson,
    isLoading: false,
  }),
}));

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

describe('WorkspaceFileExplorer', () => {
  const defaultProps = {
    machineId: 'test-machine',
    workingDir: '/test',
  };

  it('applies highlight class when selectedPath matches a node', () => {
    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath="src/index.ts"
        revealPath="src/index.ts"
      />
    );

    const selectedButton = screen.getByTitle('src/index.ts');
    expect(selectedButton.className).toContain('bg-chatroom-accent/10');
  });

  it('does not apply highlight class when selectedPath is null', () => {
    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath={null}
        revealPath="src/index.ts"
      />
    );

    const button = screen.getByTitle('src/index.ts');
    expect(button.className).not.toContain('bg-chatroom-accent/10');
  });

  it('highlights a deeply nested file when revealPath expands ancestors', () => {
    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        selectedPath="src/utils/helpers.ts"
        revealPath="src/utils/helpers.ts"
      />
    );

    const selectedButton = screen.getByTitle('src/utils/helpers.ts');
    expect(selectedButton.className).toContain('bg-chatroom-accent/10');
  });
});
