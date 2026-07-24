'use client';

import type { EventTypeRegistry } from './registry';
import { DetailRow, EventDetails, EventRow } from './shared';

import type {
  EnhancerJobCreatedEvent,
  EnhancerAttemptFailedEvent,
  EnhancerJobFailedEvent,
  EnhancerJobCompleteEvent,
  EnhancerJobCancelledEvent,
} from '@/domain/entities/event-stream-event';

function renderJobCreatedCell(
  event: EnhancerJobCreatedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="enhancer.job.created"
      badgeText="Enhancer"
      badgeColor="info"
      primaryInfo={`Job ${event.jobId.slice(-8)}`}
      secondaryInfo={`Attempt ${event.attemptCount}/${event.maxAttempts}`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderAttemptFailedCell(
  event: EnhancerAttemptFailedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="enhancer.attempt.failed"
      badgeText="Enhancer"
      badgeColor="warning"
      primaryInfo={`Attempt ${event.attemptCount}`}
      secondaryInfo={event.error}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderJobFailedCell(event: EnhancerJobFailedEvent, isSelected: boolean): React.ReactNode {
  return (
    <EventRow
      type="enhancer.job.failed"
      badgeText="Enhancer"
      badgeColor="error"
      primaryInfo={event.jobId.slice(-8)}
      secondaryInfo={event.error}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderJobCompleteCell(
  event: EnhancerJobCompleteEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="enhancer.job.complete"
      badgeText="Enhancer"
      badgeColor="success"
      primaryInfo={event.jobId.slice(-8)}
      secondaryInfo={`Attempt ${event.attemptCount}`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderJobCancelledCell(
  event: EnhancerJobCancelledEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="enhancer.job.cancelled"
      badgeText="Enhancer"
      badgeColor="warning"
      primaryInfo={event.jobId.slice(-8)}
      secondaryInfo={`Attempt ${event.attemptCount}`}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderJobCreatedDetails(event: EnhancerJobCreatedEvent): React.ReactNode {
  return (
    <EventDetails
      title="Enhancer Job Created"
      timestamp={event.timestamp}
      type="enhancer.job.created"
    >
      <DetailRow label="Job ID" value={event.jobId} mono />
      <DetailRow label="Attempt" value={`${event.attemptCount} / ${event.maxAttempts}`} />
    </EventDetails>
  );
}

function renderAttemptFailedDetails(event: EnhancerAttemptFailedEvent): React.ReactNode {
  return (
    <EventDetails
      title="Enhancer Attempt Failed"
      timestamp={event.timestamp}
      type="enhancer.attempt.failed"
    >
      <DetailRow label="Job ID" value={event.jobId} mono />
      <DetailRow label="Attempt" value={String(event.attemptCount)} />
      <DetailRow label="Error" value={event.error} />
    </EventDetails>
  );
}

function renderJobFailedDetails(event: EnhancerJobFailedEvent): React.ReactNode {
  return (
    <EventDetails
      title="Enhancer Job Failed"
      timestamp={event.timestamp}
      type="enhancer.job.failed"
    >
      <DetailRow label="Job ID" value={event.jobId} mono />
      <DetailRow label="Attempt" value={String(event.attemptCount)} />
      <DetailRow label="Error" value={event.error} />
    </EventDetails>
  );
}

function renderJobCompleteDetails(event: EnhancerJobCompleteEvent): React.ReactNode {
  return (
    <EventDetails
      title="Enhancer Job Complete"
      timestamp={event.timestamp}
      type="enhancer.job.complete"
    >
      <DetailRow label="Job ID" value={event.jobId} mono />
      <DetailRow label="Attempt" value={String(event.attemptCount)} />
    </EventDetails>
  );
}

function renderJobCancelledDetails(event: EnhancerJobCancelledEvent): React.ReactNode {
  return (
    <EventDetails
      title="Enhancer Job Cancelled"
      timestamp={event.timestamp}
      type="enhancer.job.cancelled"
    >
      <DetailRow label="Job ID" value={event.jobId} mono />
      <DetailRow label="Attempt" value={String(event.attemptCount)} />
    </EventDetails>
  );
}

export const enhancerEventDefinitions: Pick<
  EventTypeRegistry,
  | 'enhancer.job.created'
  | 'enhancer.attempt.failed'
  | 'enhancer.job.failed'
  | 'enhancer.job.complete'
  | 'enhancer.job.cancelled'
> = {
  'enhancer.job.created': {
    cellRenderer: renderJobCreatedCell,
    detailsRenderer: renderJobCreatedDetails,
  },
  'enhancer.attempt.failed': {
    cellRenderer: renderAttemptFailedCell,
    detailsRenderer: renderAttemptFailedDetails,
  },
  'enhancer.job.failed': {
    cellRenderer: renderJobFailedCell,
    detailsRenderer: renderJobFailedDetails,
  },
  'enhancer.job.complete': {
    cellRenderer: renderJobCompleteCell,
    detailsRenderer: renderJobCompleteDetails,
  },
  'enhancer.job.cancelled': {
    cellRenderer: renderJobCancelledCell,
    detailsRenderer: renderJobCancelledDetails,
  },
};
