'use client';

import { useState } from 'react';

import { MachineList } from './components/MachineList';
import {
  MachinesEmptyState,
  MachinesLoadError,
  MachinesLoadingState,
} from './components/MachinesStates';
import { useMachineRows } from './hooks/useMachineRows';
import { AppSectionTabs } from '../../components/AppSectionTabs';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { InterruptedImportNotice } from '../transfer/components/InterruptedImportNotice';

/**
 * Machines page shell.
 *
 * The error boundary wraps a child that calls the queries: a hook error thrown
 * in this component would not be caught by a boundary rendered below it.
 */
export function MachinesPage() {
  return (
    <div
      className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6"
      data-testid="machines-page"
    >
      <AppSectionTabs />
      <div className="mb-6 border-b-2 border-chatroom-border pb-6">
        <h1 className="mb-2 text-lg font-bold uppercase tracking-widest">Machines</h1>
        <p className="text-sm text-chatroom-text-muted">
          Computers running the daemon for your account
        </p>
      </div>
      <InterruptedImportNotice className="mx-0 mt-0 mb-4" />
      <ErrorBoundary fallback={<MachinesLoadError />}>
        <MachinesContent />
      </ErrorBoundary>
    </div>
  );
}

function MachinesContent() {
  const { rows, isLoading } = useMachineRows();
  const [expandedMachineId, setExpandedMachineId] = useState<string | null>(null);

  if (isLoading) return <MachinesLoadingState />;
  if (rows.length === 0) return <MachinesEmptyState />;
  return (
    <MachineList
      rows={rows}
      expandedMachineId={expandedMachineId}
      onToggle={(id) => setExpandedMachineId((current) => (current === id ? null : id))}
    />
  );
}
