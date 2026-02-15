import { describe, expect, it } from 'vitest';

import {
  BACKEND_ERROR_CODES,
  type BackendErrorCode,
  FATAL_ERROR_CODES,
  NON_FATAL_ERROR_CODES,
} from '../../../config/errorCodes';

describe('errorCodes', () => {
  // ─── Completeness ──────────────────────────────────────────────────────────

  it('BACKEND_ERROR_CODES contains every BackendErrorCode value', () => {
    // The `satisfies Record<BackendErrorCode, BackendErrorCode>` in the source
    // already enforces this at the type level. This test guards against runtime
    // drift if someone edits the union but forgets the object.
    const allCodes = Object.values(BACKEND_ERROR_CODES);
    expect(allCodes.length).toBeGreaterThan(0);

    // Every value should equal its key (identity mapping)
    for (const [key, value] of Object.entries(BACKEND_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('every BackendErrorCode is classified as either fatal or non-fatal', () => {
    const allCodes = Object.values(BACKEND_ERROR_CODES) as BackendErrorCode[];
    const classified = new Set<BackendErrorCode>([...FATAL_ERROR_CODES, ...NON_FATAL_ERROR_CODES]);

    for (const code of allCodes) {
      expect(
        classified.has(code),
        `Error code "${code}" is not in FATAL_ERROR_CODES or NON_FATAL_ERROR_CODES — please classify it`
      ).toBe(true);
    }
  });

  it('FATAL_ERROR_CODES and NON_FATAL_ERROR_CODES do not overlap', () => {
    const fatalSet = new Set(FATAL_ERROR_CODES);
    for (const code of NON_FATAL_ERROR_CODES) {
      expect(
        fatalSet.has(code),
        `Error code "${code}" appears in both FATAL and NON_FATAL arrays`
      ).toBe(false);
    }
  });

  it('FATAL_ERROR_CODES + NON_FATAL_ERROR_CODES covers all codes exactly', () => {
    const allCodes = new Set(Object.values(BACKEND_ERROR_CODES) as BackendErrorCode[]);
    const combined = new Set<BackendErrorCode>([...FATAL_ERROR_CODES, ...NON_FATAL_ERROR_CODES]);

    expect(combined.size).toBe(allCodes.size);
  });

  // ─── Fatal codes ───────────────────────────────────────────────────────────

  it('FATAL_ERROR_CODES contains the expected codes', () => {
    expect(FATAL_ERROR_CODES).toContain('PARTICIPANT_NOT_FOUND');
    expect(FATAL_ERROR_CODES).toContain('CHATROOM_NOT_FOUND');
    expect(FATAL_ERROR_CODES).toContain('SESSION_INVALID');
  });

  // ─── Non-fatal codes ──────────────────────────────────────────────────────

  it('NON_FATAL_ERROR_CODES contains the expected codes', () => {
    expect(NON_FATAL_ERROR_CODES).toContain('CHALLENGE_MISMATCH');
    expect(NON_FATAL_ERROR_CODES).toContain('CHALLENGE_NOT_PENDING');
  });

  it('challenge-related codes are NOT fatal', () => {
    expect(FATAL_ERROR_CODES).not.toContain('CHALLENGE_MISMATCH');
    expect(FATAL_ERROR_CODES).not.toContain('CHALLENGE_NOT_PENDING');
  });
});
