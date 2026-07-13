'use client';

import type { EventTypeRegistry } from './registry';
import { DetailRow, EventDetails, EventRow } from './shared';

import type {
  WorkflowCompletedEvent,
  WorkflowCreatedEvent,
  WorkflowSpecifiedEvent,
  WorkflowStartedEvent,
  WorkflowStepCancelledEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepStartedEvent,
} from '@/domain/entities/event-stream-event';

function renderWorkflowStartedCell(
  event: WorkflowStartedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.started"
      badgeText="Started"
      badgeColor="info"
      primaryInfo={event.workflowKey}
      secondaryInfo={`${event.stepCount} steps`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowStartedDetails(event: WorkflowStartedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Started"
      timestamp={event.timestamp}
      type="workflow.started"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
      <DetailRow label="Created By" value={event.createdBy} />
      <DetailRow label="Step Count" value={String(event.stepCount)} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowStepCompletedCell(
  event: WorkflowStepCompletedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.stepCompleted"
      badgeText="Step Done"
      badgeColor="success"
      primaryInfo={event.workflowKey}
      secondaryInfo={event.stepKey}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowStepCompletedDetails(event: WorkflowStepCompletedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Completed"
      timestamp={event.timestamp}
      type="workflow.stepCompleted"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Step Key" value={event.stepKey} />
      {event.stepDescription && <DetailRow label="Description" value={event.stepDescription} />}
      {event.completedBy && <DetailRow label="Completed By" value={event.completedBy} />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowStepCancelledCell(
  event: WorkflowStepCancelledEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.stepCancelled"
      badgeText="Step Cancelled"
      badgeColor="warning"
      primaryInfo={event.workflowKey}
      secondaryInfo={event.stepKey}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowStepCancelledDetails(event: WorkflowStepCancelledEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Cancelled"
      timestamp={event.timestamp}
      type="workflow.stepCancelled"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Step Key" value={event.stepKey} />
      <DetailRow label="Reason" value={event.reason} />
      {event.cancelledBy && <DetailRow label="Cancelled By" value={event.cancelledBy} />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowCompletedCell(
  event: WorkflowCompletedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.completed"
      badgeText="Completed"
      badgeColor="success"
      primaryInfo={event.workflowKey}
      secondaryInfo={event.finalStatus}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowCompletedDetails(event: WorkflowCompletedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Completed"
      timestamp={event.timestamp}
      type="workflow.completed"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Final Status" value={event.finalStatus} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowCreatedCell(
  event: WorkflowCreatedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.created"
      badgeText="Created"
      badgeColor="info"
      primaryInfo={event.workflowKey}
      secondaryInfo={`${event.stepCount} steps`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowCreatedDetails(event: WorkflowCreatedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Created"
      timestamp={event.timestamp}
      type="workflow.created"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Created By" value={event.createdBy} />
      <DetailRow label="Step Count" value={String(event.stepCount)} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowSpecifiedCell(
  event: WorkflowSpecifiedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.specified"
      badgeText="Specified"
      badgeColor="info"
      primaryInfo={event.workflowKey}
      secondaryInfo={event.stepKey}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowSpecifiedDetails(event: WorkflowSpecifiedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Specified"
      timestamp={event.timestamp}
      type="workflow.specified"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Step Key" value={event.stepKey} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

function renderWorkflowStepStartedCell(
  event: WorkflowStepStartedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="workflow.stepStarted"
      badgeText="Step Started"
      badgeColor="info"
      primaryInfo={event.workflowKey}
      secondaryInfo={event.stepKey}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowStepStartedDetails(event: WorkflowStepStartedEvent): React.ReactNode {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Started"
      timestamp={event.timestamp}
      type="workflow.stepStarted"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} />
      <DetailRow label="Step Key" value={event.stepKey} />
      {event.stepDescription && <DetailRow label="Description" value={event.stepDescription} />}
      {event.assigneeRole && <DetailRow label="Assignee Role" value={event.assigneeRole} />}
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
    </EventDetails>
  );
}

export const workflowEventDefinitions: Pick<
  EventTypeRegistry,
  | 'workflow.started'
  | 'workflow.stepCompleted'
  | 'workflow.stepCancelled'
  | 'workflow.completed'
  | 'workflow.created'
  | 'workflow.specified'
  | 'workflow.stepStarted'
> = {
  'workflow.started': {
    cellRenderer: renderWorkflowStartedCell,
    detailsRenderer: renderWorkflowStartedDetails,
  },
  'workflow.stepCompleted': {
    cellRenderer: renderWorkflowStepCompletedCell,
    detailsRenderer: renderWorkflowStepCompletedDetails,
  },
  'workflow.stepCancelled': {
    cellRenderer: renderWorkflowStepCancelledCell,
    detailsRenderer: renderWorkflowStepCancelledDetails,
  },
  'workflow.completed': {
    cellRenderer: renderWorkflowCompletedCell,
    detailsRenderer: renderWorkflowCompletedDetails,
  },
  'workflow.created': {
    cellRenderer: renderWorkflowCreatedCell,
    detailsRenderer: renderWorkflowCreatedDetails,
  },
  'workflow.specified': {
    cellRenderer: renderWorkflowSpecifiedCell,
    detailsRenderer: renderWorkflowSpecifiedDetails,
  },
  'workflow.stepStarted': {
    cellRenderer: renderWorkflowStepStartedCell,
    detailsRenderer: renderWorkflowStepStartedDetails,
  },
};
