'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow, MarkdownDetailBlock } from './shared';
import type {
  TaskActivatedEvent,
  TaskAcknowledgedEvent,
  TaskInProgressEvent,
  TaskCompletedEvent,
} from '../viewModels/eventStreamViewModel';

// ─── Task Activated ───────────────────────────────────────────────────────────

function renderTaskActivatedCell(event: TaskActivatedEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="task.activated"
      badgeText="Activated"
      badgeColor="success"
      primaryInfo={event.role}
      secondaryInfo={event.taskStatus}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderTaskActivatedDetails(event: TaskActivatedEvent): React.ReactNode {
  return (
    <EventDetails title="Task Activated" timestamp={event.timestamp} type="task.activated">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Task ID" value={event.taskId} mono />
      <DetailRow label="Status" value={event.taskStatus} />
      <MarkdownDetailBlock label="Content" content={event.taskContent} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Task Acknowledged ───────────────────────────────────────────────────────

function renderTaskAcknowledgedCell(event: TaskAcknowledgedEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="task.acknowledged"
      badgeText="Ack'd"
      badgeColor="success"
      primaryInfo={event.role}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderTaskAcknowledgedDetails(event: TaskAcknowledgedEvent): React.ReactNode {
  return (
    <EventDetails title="Task Acknowledged" timestamp={event.timestamp} type="task.acknowledged">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Task ID" value={event.taskId} mono />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Task In Progress ────────────────────────────────────────────────────────

function renderTaskInProgressCell(event: TaskInProgressEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="task.inProgress"
      badgeText="In Progress"
      badgeColor="info"
      primaryInfo={event.role}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderTaskInProgressDetails(event: TaskInProgressEvent): React.ReactNode {
  return (
    <EventDetails title="Task In Progress" timestamp={event.timestamp} type="task.inProgress">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Task ID" value={event.taskId} mono />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Task Completed ───────────────────────────────────────────────────────────

function renderTaskCompletedCell(event: TaskCompletedEvent, isSelected: boolean): React.ReactNode {
  const badgeColor = event.finalStatus === 'completed' ? 'success' : 'error';
  return (
    <EventRow
      type="task.completed"
      badgeText="Completed"
      badgeColor={badgeColor}
      primaryInfo={event.role}
      secondaryInfo={event.finalStatus}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderTaskCompletedDetails(event: TaskCompletedEvent): React.ReactNode {
  return (
    <EventDetails title="Task Completed" timestamp={event.timestamp} type="task.completed">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Task ID" value={event.taskId} mono />
      <DetailRow label="Final Status" value={event.finalStatus} />
      {event.machineId && <DetailRow label="Machine ID" value={event.machineId} mono />}
      {event.skipAgentStatusUpdate && (
        <DetailRow label="Skip Status Update" value="Yes" />
      )}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

// ─── Register all task event types ─────────────────────────────────────────────

export function registerTaskEvents(): void {
  registerEventType('task.activated', {
    cellRenderer: renderTaskActivatedCell,
    detailsRenderer: renderTaskActivatedDetails,
  });
  registerEventType('task.acknowledged', {
    cellRenderer: renderTaskAcknowledgedCell,
    detailsRenderer: renderTaskAcknowledgedDetails,
  });
  registerEventType('task.inProgress', {
    cellRenderer: renderTaskInProgressCell,
    detailsRenderer: renderTaskInProgressDetails,
  });
  registerEventType('task.completed', {
    cellRenderer: renderTaskCompletedCell,
    detailsRenderer: renderTaskCompletedDetails,
  });
}