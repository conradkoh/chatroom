'use client';

import { MAX_PROJECT_ROOTS } from '@workspace/backend/src/domain/entities/project-root';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { AlertTriangle } from 'lucide-react';

import { AddProjectRootForm } from './AddProjectRootForm';
import { ProjectRootRow } from './ProjectRootRow';

import { Skeleton } from '@/components/ui/skeleton';
import type { MachineProjectRoot } from '@/hooks/useMachineProjectRoots';
import { useMachineProjectRoots } from '@/hooks/useMachineProjectRoots';

export interface MachineProjectRootsProps {
  machineId: string;
  /** alias || hostname; used in picker waiting text. */
  displayName: string;
  hostname: string;
  alias?: string;
  /** From the row model; false = offline. undefined = checking (treated as not offline). */
  connected: boolean | undefined;
}

const SECTION_HEADING_CLASS =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

function ProjectRootsLoading() {
  return (
    <div data-testid="project-roots-loading" className="mt-3 space-y-2">
      <Skeleton className="h-9 w-full rounded-none" />
      <Skeleton className="h-9 w-full rounded-none" />
      <Skeleton className="h-9 w-full rounded-none" />
    </div>
  );
}

function ProjectRootsEmpty() {
  return (
    <p data-testid="project-roots-empty" className="mt-3 text-xs text-chatroom-text-muted">
      No project roots yet. Add a folder so the daemon can find your git repositories.
    </p>
  );
}

/** Loading, empty and populated list share one slot above the add form. */
function ProjectRootsBody({
  roots,
  onRemove,
}: {
  roots: MachineProjectRoot[] | undefined;
  onRemove: (rootId: Id<'chatroom_machineProjectRoots'>) => Promise<unknown>;
}) {
  if (roots === undefined) return <ProjectRootsLoading />;
  if (roots.length === 0) return <ProjectRootsEmpty />;
  return (
    <ul data-testid="project-roots-list" className="mt-3 space-y-2">
      {roots.map((root) => (
        <ProjectRootRow key={root.rootId} root={root} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function OfflineNote() {
  return (
    <div
      role="note"
      data-testid="project-roots-offline"
      className="mt-3 flex items-start gap-2 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 p-3 text-xs text-chatroom-text-primary"
    >
      <AlertTriangle size={14} className="shrink-0 text-chatroom-status-warning" />
      <span>Machine is offline. Start the daemon to add roots. You can still remove roots.</span>
    </div>
  );
}

function LimitNote() {
  return (
    <p data-testid="project-roots-limit" className="mt-2 text-xs text-chatroom-text-muted">
      You&apos;ve reached the {MAX_PROJECT_ROOTS} root limit. Remove a root to add another.
    </p>
  );
}

/**
 * Project roots manager: the expandable card's first section.
 *
 * Mounted only while the card is expanded, so collapsed cards hold no roots
 * subscription. Adding needs the machine online; removing works offline.
 */
export function MachineProjectRoots({
  machineId,
  displayName,
  hostname,
  alias,
  connected,
}: MachineProjectRootsProps) {
  const { roots, addRoot, removeRoot } = useMachineProjectRoots(machineId);
  const offline = connected === false;
  const atLimit = roots !== undefined && roots.length >= MAX_PROJECT_ROOTS;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className={SECTION_HEADING_CLASS}>Project roots</h3>
        {roots !== undefined && (
          <span
            data-testid="project-roots-count"
            className="text-[10px] font-mono text-chatroom-text-muted"
          >
            {roots.length} / {MAX_PROJECT_ROOTS}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-chatroom-text-muted">
        Folders the daemon scans for git repositories.
      </p>
      {offline && <OfflineNote />}
      <ProjectRootsBody roots={roots} onRemove={removeRoot} />
      <div className="mt-4">
        <AddProjectRootForm
          machineId={machineId}
          displayName={displayName}
          hostname={hostname}
          alias={alias}
          offline={offline}
          atLimit={atLimit}
          onAdd={addRoot}
        />
      </div>
      {atLimit && <LimitNote />}
    </div>
  );
}
