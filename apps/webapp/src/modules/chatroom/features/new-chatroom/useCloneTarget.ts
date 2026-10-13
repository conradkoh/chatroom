'use client';

import { deriveRepoFolderName, joinClonePath } from '@workspace/shared/domain/git-clone';
import { useCallback, useState } from 'react';

import { useSetupWorkspaceFolderPicker } from '../../components/setup/useSetupWorkspaceFolderPicker';
import type { UserMachine } from '../../types/machine';

/** Folder name for a repo, with a fallback when the URL has none usable. */
function cloneFolderName(repoUrl: string): string {
  return deriveRepoFolderName(repoUrl) ?? 'repo';
}

/**
 * The repo URL and target folder. Until the user types a target, the target follows the URL and
 * the parent folder chosen with Browse.
 */
export function useCloneTarget(machine: UserMachine) {
  const [repoUrl, setRepoUrl] = useState('');
  const [cloneTo, setCloneTo] = useState('');
  const [cloneToTouched, setCloneToTouched] = useState(false);
  const [parentDir, setParentDir] = useState<string | null>(null);

  const handleParentPicked = useCallback(
    (parent: string) => {
      setParentDir(parent);
      setCloneTo(joinClonePath(parent, cloneFolderName(repoUrl)));
      setCloneToTouched(false);
    },
    [repoUrl]
  );

  const { picker } = useSetupWorkspaceFolderPicker({
    selectedMachineId: machine.machineId,
    selectedMachine: machine,
    onPathSelected: handleParentPicked,
  });

  const handleRepoUrlChange = (value: string) => {
    setRepoUrl(value);
    if (!cloneToTouched && parentDir !== null) {
      setCloneTo(joinClonePath(parentDir, cloneFolderName(value)));
    }
  };

  const handleCloneToChange = (value: string) => {
    setCloneTo(value);
    setCloneToTouched(true);
  };

  return {
    repoUrl,
    cloneTo,
    picker,
    handleRepoUrlChange,
    handleCloneToChange,
  };
}
