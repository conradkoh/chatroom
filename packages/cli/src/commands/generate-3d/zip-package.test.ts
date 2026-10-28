/**
 * Zip writer tests.
 *
 * The package has to be reproducible, so the interesting properties are the
 * round-trip, the fixed order, and byte equality across calls.
 */

import { createHash } from 'node:crypto';

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { zipPackage, type ZipEntry } from './zip-package.js';

const MASTER = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
const WEB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 9, 9, 9]);
const MANIFEST = new TextEncoder().encode('{"schemaVersion":1}');

const ENTRIES: ZipEntry[] = [
  { path: 'manifest.json', bytes: MANIFEST },
  { path: 'web/chest.web.glb', bytes: WEB },
  { path: 'chest.glb', bytes: MASTER },
];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('zipPackage', () => {
  it('round-trips every entry with its exact bytes', () => {
    const archive = zipPackage(ENTRIES);
    const unzipped = unzipSync(archive);

    expect(Object.keys(unzipped).sort()).toEqual([
      'chest.glb',
      'manifest.json',
      'web/chest.web.glb',
    ]);
    expect([...unzipped['chest.glb']!]).toEqual([...MASTER]);
    expect([...unzipped['web/chest.web.glb']!]).toEqual([...WEB]);
    expect([...unzipped['manifest.json']!]).toEqual([...MANIFEST]);
  });

  it('produces identical bytes across two calls', () => {
    expect(sha256(zipPackage(ENTRIES))).toBe(sha256(zipPackage(ENTRIES)));
  });

  it('sorts entries, so input order does not change the archive', () => {
    const reversed = [...ENTRIES].reverse();

    expect(sha256(zipPackage(reversed))).toBe(sha256(zipPackage(ENTRIES)));
  });

  it('keeps reference, rig, clip, and web entries in sorted order', () => {
    const archive = zipPackage([
      { path: 'web/chest.web.glb', bytes: WEB },
      { path: 'web/chest.rigged.web.glb', bytes: WEB },
      { path: 'web/chest.anim-0.web.glb', bytes: WEB },
      { path: 'chest.anim-0.glb', bytes: MASTER },
      { path: 'chest.rigged.glb', bytes: MASTER },
      { path: 'reference/chest-reference.png', bytes: MANIFEST },
      { path: 'manifest.json', bytes: MANIFEST },
      { path: 'chest.glb', bytes: MASTER },
    ]);

    expect(Object.keys(unzipSync(archive))).toEqual([
      'chest.anim-0.glb',
      'chest.glb',
      'chest.rigged.glb',
      'manifest.json',
      'reference/chest-reference.png',
      'web/chest.anim-0.web.glb',
      'web/chest.rigged.web.glb',
      'web/chest.web.glb',
    ]);
  });

  it('writes a single-entry archive unchanged through a round trip', () => {
    const unzipped = unzipSync(zipPackage([{ path: 'only.glb', bytes: MASTER }]));

    expect([...unzipped['only.glb']!]).toEqual([...MASTER]);
  });
});
