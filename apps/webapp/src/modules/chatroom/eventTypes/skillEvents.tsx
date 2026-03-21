'use client';

import { registerEventType } from './registry';
import { EventRow, EventDetails, DetailRow, MarkdownDetailBlock } from './shared';
import type { SkillActivatedEvent } from '../viewModels/eventStreamViewModel';

// ─── Skill Activated ───────────────────────────────────────────────────────────

function renderSkillActivatedCell(
  event: SkillActivatedEvent,
  isSelected: boolean
): React.ReactNode {
  return (
    <EventRow
      type="skill.activated"
      badgeText="Skill"
      badgeColor="purple"
      primaryInfo={event.role}
      secondaryInfo={event.skillName}
      timestamp={event.timestamp}
      isSelected={isSelected}
    />
  );
}

function renderSkillActivatedDetails(event: SkillActivatedEvent): React.ReactNode {
  return (
    <EventDetails title="Skill Activated" timestamp={event.timestamp} type="skill.activated">
      <DetailRow label="Role" value={event.role} />
      <DetailRow label="Skill ID" value={event.skillId} mono />
      <DetailRow label="Skill Name" value={event.skillName} />
      <DetailRow label="Chatroom ID" value={event.chatroomId} mono />
      <MarkdownDetailBlock label="Prompt" content={event.prompt} />
    </EventDetails>
  );
}

// ─── Register skill event types ────────────────────────────────────────────────

export function registerSkillEvents(): void {
  registerEventType('skill.activated', {
    cellRenderer: renderSkillActivatedCell,
    detailsRenderer: renderSkillActivatedDetails,
  });
}
