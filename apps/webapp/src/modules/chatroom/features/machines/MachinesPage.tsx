'use client';

import { MachineList } from './components/MachineList';
import {
  MachinesEmptyState,
  MachinesLoadError,
  MachinesLoadingState,
} from './components/MachinesStates';
import { useMachineRows } from './hooks/useMachineRows';
import { ErrorBoundary } from '../../components/ErrorBoundary';

/**
 * Machines page shell.
 *
 * The error boundary wraps a child that calls the queries: a hook error thrown
 * in this component would not be caught by a boundary rendered below it.
 */
export function MachinesPage() {
  return (
    <div
      className="chatroom-root min-h-screen bg-chatroom-bg-primary p-4 text-chatroom-text-primary sm:p-6"
      data-testid="machines-page"
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Section tab strip lands here in pass 3. */}
        <div className="mb-6 border-b-2 border-chatroom-border pb-6">
          <h1 className="mb-2 text-lg font-bold uppercase tracking-widest">Machines</h1>
          <p className="text-sm text-chatroom-text-muted">
            Computers running the daemon for your account
          </p>
        </div>
        <ErrorBoundary fallback={<MachinesLoadError />}>
          <MachinesContent />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function MachinesContent() {
  const { rows, isLoading } = useMachineRows();

  if (isLoading) return <MachinesLoadingState />;
  if (rows.length === 0) return <MachinesEmptyState />;
  return <MachineList rows={rows} />;
}
