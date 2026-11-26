/**
 * queuedReorderModel — pure ordering maths for the queued reorder UI.
 *
 * Every expectation below uses literal ids and literal orders; nothing is
 * recomputed with the module's own formula.
 */

import { describe, expect, it } from 'vitest';

import {
  anchorForSlot,
  insertAfter,
  insertAtSlot,
  originalSlot,
  slotFromHover,
  withoutId,
} from './queuedReorderModel';

const IDS = ['a', 'b', 'c'];

describe('queuedReorderModel', () => {
  describe('originalSlot', () => {
    it('returns the index of the moved row', () => {
      expect(originalSlot(IDS, 'a')).toBe(0);
      expect(originalSlot(IDS, 'b')).toBe(1);
      expect(originalSlot(IDS, 'c')).toBe(2);
    });

    it('returns -1 for an unknown row', () => {
      expect(originalSlot(IDS, 'nope')).toBe(-1);
    });
  });

  describe('withoutId', () => {
    it('drops only the moved id and keeps order', () => {
      expect(withoutId(IDS, 'b')).toEqual(['a', 'c']);
    });
  });

  describe('insertAtSlot', () => {
    it('moves to the front', () => {
      expect(insertAtSlot(IDS, 'c', 0)).toEqual(['c', 'a', 'b']);
    });

    it('moves to the middle', () => {
      expect(insertAtSlot(IDS, 'a', 1)).toEqual(['b', 'a', 'c']);
    });

    it('moves to the end', () => {
      expect(insertAtSlot(IDS, 'a', 2)).toEqual(['b', 'c', 'a']);
    });

    it('clamps out-of-range slots', () => {
      expect(insertAtSlot(IDS, 'a', -5)).toEqual(['a', 'b', 'c']);
      expect(insertAtSlot(IDS, 'a', 99)).toEqual(['b', 'c', 'a']);
    });

    it('is a no-op when the slot equals the original slot', () => {
      expect(insertAtSlot(IDS, 'b', 1)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('anchorForSlot', () => {
    it('returns null for the front', () => {
      expect(anchorForSlot(IDS, 'c', 0)).toBeNull();
    });

    it('returns the row before the slot in the middle', () => {
      expect(anchorForSlot(IDS, 'a', 1)).toBe('b');
      expect(anchorForSlot(IDS, 'a', 2)).toBe('c');
    });

    it('returns the last row for the end', () => {
      expect(anchorForSlot(IDS, 'a', 2)).toBe('c');
      expect(anchorForSlot(IDS, 'c', 2)).toBe('b');
    });
  });

  describe('insertAfter', () => {
    it('moves to the front with a null anchor', () => {
      expect(insertAfter(IDS, 'c', null)).toEqual(['c', 'a', 'b']);
    });

    it('moves after a neighbour', () => {
      expect(insertAfter(IDS, 'a', 'b')).toEqual(['b', 'a', 'c']);
      expect(insertAfter(IDS, 'a', 'c')).toEqual(['b', 'c', 'a']);
    });

    it('is a no-op when already after the anchor', () => {
      expect(insertAfter(IDS, 'b', 'a')).toEqual(['a', 'b', 'c']);
      expect(insertAfter(IDS, 'b', null)).toEqual(['b', 'a', 'c']);
    });

    it('returns the input unchanged when the anchor is missing', () => {
      expect(insertAfter(IDS, 'a', 'missing')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('slotFromHover', () => {
    it('maps the before half to the hovered row index', () => {
      expect(slotFromHover(IDS, 'a', 'b', 'before')).toBe(0);
      expect(slotFromHover(IDS, 'a', 'c', 'before')).toBe(1);
    });

    it('maps the after half to the slot after the hovered row', () => {
      expect(slotFromHover(IDS, 'a', 'b', 'after')).toBe(1);
      expect(slotFromHover(IDS, 'a', 'c', 'after')).toBe(2);
    });

    it('returns null when hovering the moved row itself', () => {
      expect(slotFromHover(IDS, 'b', 'b', 'before')).toBeNull();
      expect(slotFromHover(IDS, 'b', 'b', 'after')).toBeNull();
    });

    it('returns null for an unknown hovered row', () => {
      expect(slotFromHover(IDS, 'a', 'nope', 'after')).toBeNull();
    });
  });
});
