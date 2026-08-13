import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import { enqueueOutbox } from './outbox.js';
import { shouldEnqueueOutbox } from '../projection/sync-policy.js';

export function appendOutboundEvent(db: DatabaseSync, event: OutboundEvent): number {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO outbound_events(event_type, payload_json, created_at)
       VALUES(?, ?, ?)`
    )
    .run(event.type, JSON.stringify(event), now);
  return Number(result.lastInsertRowid);
}

export function appendOutboundEventWithOutbox(db: DatabaseSync, event: OutboundEvent): number {
  const id = appendOutboundEvent(db, event);
  if (shouldEnqueueOutbox(event)) enqueueOutbox(db, id);
  return id;
}

export function loadOutboundEventById(db: DatabaseSync, id: number): OutboundEvent | null {
  const row = db.prepare(`SELECT payload_json FROM outbound_events WHERE id = ?`).get(id) as
    { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as OutboundEvent;
}
