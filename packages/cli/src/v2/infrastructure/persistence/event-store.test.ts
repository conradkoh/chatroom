import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendOutboundEvent } from './event-store.js';
import { openDatabase } from './open-database.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-event-store-'));
  return join(dir, 'events.sqlite');
}

describe('appendOutboundEvent', () => {
  it('persists event type and JSON payload', () => {
    const db = openDatabase(tempDbPath());
    try {
      const event = {
        type: 'heartbeat' as const,
        machineId: 'machine-1',
      };
      const id = appendOutboundEvent(db, event);
      expect(id).toBeGreaterThan(0);

      const row = db
        .prepare(`SELECT event_type, payload_json FROM outbound_events WHERE id = ?`)
        .get(id) as { event_type: string; payload_json: string };

      expect(row.event_type).toBe('heartbeat');
      expect(JSON.parse(row.payload_json)).toEqual(event);
    } finally {
      db.close();
    }
  });
});
