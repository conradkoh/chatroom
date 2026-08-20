import { describe, expect, it } from 'vitest';
import { EVENT_TYPE_CATALOG, resolveEventTypeMeta } from './event-type-catalog';
import { getClassificationStyle } from './event-classification';
describe('event type catalog', () => { it('resolves known and unknown types', () => { expect(resolveEventTypeMeta('agent.exited')).toEqual({ label: 'Agent Exited', classification: 'error' }); expect(resolveEventTypeMeta('task.custom').classification).toBe('success'); expect(Object.keys(EVENT_TYPE_CATALOG)).toHaveLength(54); }); it('resolves classification styles', () => { expect(getClassificationStyle('error').badge).toContain('status-error'); }); });
