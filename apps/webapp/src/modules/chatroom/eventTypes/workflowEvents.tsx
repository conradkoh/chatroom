'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow } from './shared';
import type {
  WorkflowStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepCancelledEvent,
  WorkflowCompletedEvent,
} from '../viewModels/eventStreamViewModel';

// ─── Workflow Started ──────────────────────────────────────────────

function renderWorkflowStartedCell(event: WorkflowStartedEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.started"
      badgeText="Workflow"
      badgeColor="info"
      primaryInfo={event.workflowKey}
      secondaryInfo={`${event.stepCount} steps`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowStartedDetails(event: WorkflowStartedEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Started"
      timestamp={event.timestamp}
      type="workflow.started"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      <DetailRow label="Created By" value={event.createdBy} />
      <DetailRow label="Steps" value={String(event.stepCount)} />
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
    </EventDetails>
  );
}

// ─── Workflow Step Completed ───────────────────────────────────────

function renderStepCompletedCell(event: WorkflowStepCompletedEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.stepCompleted"
      badgeText="Step ✅"
      badgeColor="success"
      primaryInfo={event.stepKey}
      secondaryInfo={event.completedBy ?? ''}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderStepCompletedDetails(event: WorkflowStepCompletedEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Completed"
      timestamp={event.timestamp}
      type="workflow.stepCompleted"
    >
      <DetailRow label="Step Key" value={event.stepKey} mono />
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      {event.completedBy && <DetailRow label="Completed By" value={event.completedBy} />}
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
    </EventDetails>
  );
}

// ─── Workflow Step Cancelled ───────────────────────────────────────

function renderStepCancelledCell(event: WorkflowStepCancelledEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.stepCancelled"
      badgeText="Step ❌"
      badgeColor="error"
      primaryInfo={event.stepKey}
      secondaryInfo={event.cancelledBy ?? ''}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderStepCancelledDetails(event: WorkflowStepCancelledEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Cancelled"
      timestamp={event.timestamp}
      type="workflow.stepCancelled"
    >
      <DetailRow label="Step Key" value={event.stepKey} mono />
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      <DetailRow label="Reason" value={event.reason} />
      {event.cancelledBy && <DetailRow label="Cancelled By" value={event.cancelledBy} />}
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
    </EventDetails>
  );
}

// ─── Workflow Completed ────────────────────────────────────────────

function renderWorkflowCompletedCell(event: WorkflowCompletedEvent, isSelected: boolean) {
  const isSuccess = event.finalStatus === 'completed';
  return (
    <EventRow
      type="workflow.completed"
      badgeText={isSuccess ? 'Done ✅' : 'Cancelled ❌'}
      badgeColor={isSuccess ? 'success' : 'error'}
      primaryInfo={event.workflowKey}
      secondaryInfo={event.finalStatus}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowCompletedDetails(event: WorkflowCompletedEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Completed"
      timestamp={event.timestamp}
      type="workflow.completed"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      <DetailRow label="Final Status" value={event.finalStatus} />
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
    </EventDetails>
  );
}

// ─── Register ──────────────────────────────────────────────────────

export function registerWorkflowEvents(): void {
  registerEventType('workflow.started', {
    cellRenderer: renderWorkflowStartedCell,
    detailsRenderer: renderWorkflowStartedDetails,
  });
  registerEventType('workflow.stepCompleted', {
    cellRenderer: renderStepCompletedCell,
    detailsRenderer: renderStepCompletedDetails,
  });
  registerEventType('workflow.stepCancelled', {
    cellRenderer: renderStepCancelledCell,
    detailsRenderer: renderStepCancelledDetails,
  });
  registerEventType('workflow.completed', {
    cellRenderer: renderWorkflowCompletedCell,
    detailsRenderer: renderWorkflowCompletedDetails,
  });
}
