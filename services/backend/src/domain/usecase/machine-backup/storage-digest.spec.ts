/**
 * Spike: what digest encoding does the storage system table record?
 *
 * The daemon reports SHA-256 as lowercase hex. convex-test stores `_storage.sha256` as base64 of
 * the digest, so both sides are normalized with `toHexSha256` before comparison. The expected
 * value here is the literal SHA-256 of "abc", not the output of the function under test.
 */
import { describe, expect, test } from 'vitest';

import { t } from '../../../../test.setup';
import { toHexSha256 } from '../../entities/machine-backup';

const SHA256_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('machine backup storage digest', () => {
  test('convex-test records a 3-byte blob whose digest normalizes to the SHA-256 of "abc"', async () => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['abc'])));

    const meta = await t.run((ctx) => ctx.db.system.get('_storage', storageId));

    expect(meta).not.toBeNull();
    expect(meta!.size).toBe(3);
    expect(toHexSha256(meta!.sha256)).toBe(SHA256_OF_ABC);
  });
});
