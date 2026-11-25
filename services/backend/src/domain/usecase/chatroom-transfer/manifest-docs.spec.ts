/**
 * Chatroom transfer docs ↔ omitted manifest.
 *
 * The feature guide must name every exclusion with the registry's exact reason.
 * This spec is the seam: it reads `docs/features/chatroom-export-import.md` and
 * fails when a reason drifts or a disclosure goes missing. It does not parse the
 * markdown — a verbatim `contains` check is enough to catch a stale copy.
 *
 * The file lives six directories below the repo root
 * (`services/backend/src/domain/usecase/chatroom-transfer`). The root is resolved
 * from this file's URL and verified before it is used, so a moved spec fails
 * loudly instead of silently reading something else.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { omittedManifest } from './registry';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..', '..');
const DOC_PATH = resolve(REPO_ROOT, 'docs', 'features', 'chatroom-export-import.md');

/** Fails before the assertions when the relative root is wrong. */
function assertDocExists(): void {
  if (!existsSync(DOC_PATH)) {
    throw new Error(`feature guide not found at ${DOC_PATH}; check the repo-root depth`);
  }
}

describe('chatroom transfer feature guide', () => {
  test('names every omission with the registry reason and keeps the disclosures', async () => {
    assertDocExists();
    const doc = await readFile(DOC_PATH, 'utf8');

    for (const [key, entry] of Object.entries(omittedManifest())) {
      expect(doc, `docs/features/chatroom-export-import.md is missing ${key}`).toContain(
        entry.reason
      );
    }

    expect(doc).toContain('_creationTime');
    expect(doc).toContain('no agents were started');
  });
});
