import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceCommandsAggregator } from './WorkspaceCommandsAggregator';
import type { Workspace } from '../../types/workspace';
import { dedupeWorkspacesById } from '../../workspace/hooks/useChatroomWorkspaces';

const useWorkspaceCommandItems = vi.fn(() => [] as never[]);

vi.mock('./useWorkspaceCommandItems', () => ({
  useWorkspaceCommandItems: (...args: unknown[]) => useWorkspaceCommandItems(...args),
}));

function mkWorkspace(machineId: string, workingDir: string): Workspace {
  return {
    id: `${machineId}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: [],
  };
}

describe('WorkspaceCommandsAggregator', () => {
  it('renders one watcher per unique workspace id (no duplicate React keys)', () => {
    const machineId = '352a8994-0b30-4558-835c-0a87b95c62ca';
    const workingDir = '/Users/conradkoh/Documents/Repos/baby-tracker';
    const duplicates = [mkWorkspace(machineId, workingDir), mkWorkspace(machineId, workingDir)];
    const workspaces = dedupeWorkspacesById(duplicates);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    useWorkspaceCommandItems.mockClear();

    render(
      <WorkspaceCommandsAggregator
        workspaces={workspaces}
        callbacks={{}}
        onCommandsChange={vi.fn()}
      />
    );

    expect(useWorkspaceCommandItems).toHaveBeenCalledTimes(1);

    const duplicateKeyErrors = consoleError.mock.calls.filter(([msg]) =>
      String(msg).includes('Encountered two children with the same key')
    );
    expect(duplicateKeyErrors).toHaveLength(0);

    consoleError.mockRestore();
  });
});
