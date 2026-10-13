'use client';

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { deriveInitialWorkingDir } from './initialization';
import type { AgentConfig, AgentHarness } from '../../types/machine';
import type { Workspace } from '../../types/workspace';

/**
 * The user's choices for machine, harness, model and working dir. Each one marks the favourite
 * default as decided, so a later favourites load cannot override it.
 */
export function useSelectionHandlers({
  lockedMachineId,
  lockedWorkingDir,
  roleConfigs,
  chatroomWorkspaces,
  selectedHarness,
  harnessTouchedRef,
  favoriteDefaultAppliedForRef,
  setSelectedMachineId,
  setSelectedHarness,
  setUserModelByHarness,
  setWorkingDir,
}: {
  lockedMachineId?: string;
  lockedWorkingDir?: string;
  roleConfigs: AgentConfig[];
  chatroomWorkspaces?: Workspace[];
  selectedHarness: AgentHarness | null;
  harnessTouchedRef: RefObject<boolean>;
  favoriteDefaultAppliedForRef: RefObject<string | null>;
  setSelectedMachineId: Dispatch<SetStateAction<string | null>>;
  setSelectedHarness: Dispatch<SetStateAction<AgentHarness | null>>;
  setUserModelByHarness: Dispatch<SetStateAction<Partial<Record<AgentHarness, string>>>>;
  setWorkingDir: Dispatch<SetStateAction<string>>;
}) {
  // Machine change clears harness and per-harness model memory, then re-initializes the working dir.
  const handleMachineChange = useCallback(
    (machineId: string | null) => {
      if (lockedMachineId) return;
      setSelectedMachineId(machineId);
      setSelectedHarness(null);
      setUserModelByHarness({});
      // A new machine gets its own one-shot favourite default.
      harnessTouchedRef.current = false;
      favoriteDefaultAppliedForRef.current = null;
      setWorkingDir(deriveInitialWorkingDir(machineId, roleConfigs, chatroomWorkspaces));
    },
    [
      roleConfigs,
      chatroomWorkspaces,
      lockedMachineId,
      harnessTouchedRef,
      favoriteDefaultAppliedForRef,
      setSelectedMachineId,
      setSelectedHarness,
      setUserModelByHarness,
      setWorkingDir,
    ]
  );

  // Does NOT clear other harnesses' model memory. Marks the harness as explicitly chosen so a late
  // favourites load cannot override it.
  const handleHarnessChange = useCallback(
    (harness: AgentHarness | null) => {
      harnessTouchedRef.current = true;
      setSelectedHarness(harness);
    },
    [harnessTouchedRef, setSelectedHarness]
  );

  // A user-chosen model is stored per harness.
  const handleModelChange = useCallback(
    (model: string | null, harnessOverride?: AgentHarness | null) => {
      const harness = harnessOverride ?? selectedHarness;
      if (!harness) return;
      harnessTouchedRef.current = true;
      if (model) {
        setUserModelByHarness((prev) => ({ ...prev, [harness]: model }));
      } else {
        setUserModelByHarness((prev) => {
          const next = { ...prev };
          delete next[harness];
          return next;
        });
      }
    },
    [selectedHarness, harnessTouchedRef, setUserModelByHarness]
  );

  const handleWorkingDirChange = useCallback(
    (dir: string) => {
      if (lockedWorkingDir) return;
      setWorkingDir(dir);
    },
    [lockedWorkingDir, setWorkingDir]
  );

  return { handleMachineChange, handleHarnessChange, handleModelChange, handleWorkingDirChange };
}
