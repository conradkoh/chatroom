'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { useState } from 'react';

import { WorkflowVisualizer } from '../components/WorkflowVisualizer';
import { buildWorkflowMermaid } from '../utils/workflowMermaid';
import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow, MarkdownDetailBlock } from './shared';
import type {
  WorkflowStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepCancelledEvent,
  WorkflowCompletedEvent,
  WorkflowCreatedEvent,
  WorkflowSpecifiedEvent,
  WorkflowStepStartedEvent,
} from '../viewModels/eventStreamViewModel';

// ─── View Workflow Button ──────────────────────────────────────────

/**
 * Shared button that opens the WorkflowVisualizer modal.
 * Used across all workflow event detail views.
 */
function WorkflowVisualizerButton({
  workflowId,
  chatroomId,
}: {
  workflowId: string;
  chatroomId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div className="px-4 pt-2 pb-1">
        <button
          onClick={() => setIsOpen(true)}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-chatroom-bg-tertiary hover:bg-chatroom-bg-hover border border-chatroom-border text-chatroom-text-secondary transition-colors"
        >
          View Workflow
        </button>
      </div>
      <WorkflowVisualizer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        chatroomId={chatroomId as Id<'chatroom_rooms'>}
        workflowId={workflowId as Id<'chatroom_workflows'>}
      />
    </>
  );
}

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
  const mermaidChart = event.steps && event.steps.length > 0
    ? buildWorkflowMermaid(event.steps)
    : null;

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
      {mermaidChart && (
        <MarkdownDetailBlock
          label="Step Graph"
          content={`\`\`\`mermaid\n${mermaidChart}\n\`\`\``}
        />
      )}
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
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
      primaryInfo={event.stepDescription ?? event.stepKey}
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
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
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
      primaryInfo={event.stepDescription ?? event.stepKey}
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
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
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
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
    </EventDetails>
  );
}

// ─── Workflow Created ──────────────────────────────────────────────

function renderWorkflowCreatedCell(event: WorkflowCreatedEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.created"
      badgeText="Draft 📝"
      badgeColor="muted"
      primaryInfo={event.workflowKey}
      secondaryInfo={`${event.stepCount} steps`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowCreatedDetails(event: WorkflowCreatedEvent) {
  const mermaidChart = event.steps && event.steps.length > 0
    ? buildWorkflowMermaid(event.steps)
    : null;

  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Created"
      timestamp={event.timestamp}
      type="workflow.created"
    >
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      <DetailRow label="Created By" value={event.createdBy} />
      <DetailRow label="Steps" value={String(event.stepCount)} />
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
      {mermaidChart && (
        <MarkdownDetailBlock
          label="Step Graph"
          content={`\`\`\`mermaid\n${mermaidChart}\n\`\`\``}
        />
      )}
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
    </EventDetails>
  );
}

// ─── Workflow Specified ────────────────────────────────────────────

function renderWorkflowSpecifiedCell(event: WorkflowSpecifiedEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.specified"
      badgeText="Specified 📋"
      badgeColor="info"
      primaryInfo={event.stepKey}
      secondaryInfo={event.workflowKey}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderWorkflowSpecifiedDetails(event: WorkflowSpecifiedEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Specified"
      timestamp={event.timestamp}
      type="workflow.specified"
    >
      <DetailRow label="Step Key" value={event.stepKey} mono />
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
    </EventDetails>
  );
}

// ─── Workflow Step Started ─────────────────────────────────────────

function renderStepStartedCell(event: WorkflowStepStartedEvent, isSelected: boolean) {
  return (
    <EventRow
      type="workflow.stepStarted"
      badgeText="Step ▶️"
      badgeColor="info"
      primaryInfo={event.stepDescription ?? event.stepKey}
      secondaryInfo={event.assigneeRole ?? ''}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderStepStartedDetails(event: WorkflowStepStartedEvent) {
  return (
    <EventDetails
      eventId={event._id}
      title="Workflow Step Started"
      timestamp={event.timestamp}
      type="workflow.stepStarted"
    >
      <DetailRow label="Step Key" value={event.stepKey} mono />
      <DetailRow label="Workflow Key" value={event.workflowKey} mono />
      {event.assigneeRole && <DetailRow label="Assignee" value={event.assigneeRole} />}
      <DetailRow label="Workflow ID" value={event.workflowId} mono />
      <WorkflowVisualizerButton workflowId={event.workflowId} chatroomId={event.chatroomId} />
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
  registerEventType('workflow.created', {
    cellRenderer: renderWorkflowCreatedCell,
    detailsRenderer: renderWorkflowCreatedDetails,
  });
  registerEventType('workflow.specified', {
    cellRenderer: renderWorkflowSpecifiedCell,
    detailsRenderer: renderWorkflowSpecifiedDetails,
  });
  registerEventType('workflow.stepStarted', {
    cellRenderer: renderStepStartedCell,
    detailsRenderer: renderStepStartedDetails,
  });
}
