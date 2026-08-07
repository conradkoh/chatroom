'use client';

import { memo, useMemo } from 'react';

import { EventStreamPanel } from './EventStreamPanel';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { useEventStream } from '../hooks/useEventStream';

interface EventStreamTabProps {
  chatroomId: string;
  isActive: boolean;
}

export const EventStreamTab = memo(function EventStreamTab({
  chatroomId,
  isActive,
}: EventStreamTabProps) {
  const { events, isLoading, canLoadMore, loadMore } = useEventStream(chatroomId, isActive);
  const { connectedMachines } = useAgentPanelData(chatroomId);

  const machines = useMemo(() => {
    const map = new Map<string, { hostname: string; alias?: string }>();
    for (const machine of connectedMachines) {
      map.set(machine.machineId, { hostname: machine.hostname, alias: machine.alias });
    }
    return map;
  }, [connectedMachines]);

  return (
    <div className="flex flex-col min-h-0 h-full gap-4">
      <div>
        <p className="text-xs text-chatroom-text-muted">
          Browse agent, task, and daemon activity for this chatroom. Events load when you open this
          tab.
        </p>
      </div>
      <div className="flex-1 min-h-[420px]">
        <EventStreamPanel
          events={events}
          isLoading={isLoading}
          onLoadMore={loadMore}
          hasMore={canLoadMore}
          machines={machines}
          className="h-full"
        />
      </div>
    </div>
  );
});
