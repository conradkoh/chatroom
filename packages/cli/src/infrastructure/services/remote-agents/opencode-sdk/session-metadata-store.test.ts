import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  InMemorySessionMetadataStore,
  FileSessionMetadataStore,
  type SessionMetadata,
} from './session-metadata-store.js';

const SAMPLE_META: SessionMetadata = {
  sessionId: 'sess-1',
  machineId: 'm1',
  chatroomId: 'c1',
  role: 'builder',
  pid: 1234,
  createdAt: '2026-04-25T00:00:00.000Z',
  baseUrl: 'http://127.0.0.1:5678',
};

describe('InMemorySessionMetadataStore', () => {
  let store: InMemorySessionMetadataStore;

  beforeEach(() => {
    store = new InMemorySessionMetadataStore();
  });

  describe('get', () => {
    it('returns undefined for absent session', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('returns stored session by id', () => {
      store.upsert(SAMPLE_META);
      expect(store.get('sess-1')).toEqual(SAMPLE_META);
    });
  });

  describe('findByPid', () => {
    it('returns undefined for absent pid', () => {
      expect(store.findByPid(9999)).toBeUndefined();
    });

    it('finds session by pid', () => {
      store.upsert(SAMPLE_META);
      expect(store.findByPid(1234)).toEqual(SAMPLE_META);
    });
  });

  describe('upsert', () => {
    it('stores new session', () => {
      store.upsert(SAMPLE_META);
      expect(store.get('sess-1')).toEqual(SAMPLE_META);
    });

    it('overwrites existing session', () => {
      store.upsert(SAMPLE_META);
      const updated = { ...SAMPLE_META, baseUrl: 'http://127.0.0.1:9999' };
      store.upsert(updated);
      expect(store.get('sess-1')).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('is no-op for absent session', () => {
      expect(() => store.remove('nonexistent')).not.toThrow();
    });

    it('removes stored session', () => {
      store.upsert(SAMPLE_META);
      store.remove('sess-1');
      expect(store.get('sess-1')).toBeUndefined();
    });
  });
});

describe('FileSessionMetadataStore', () => {
  const tmpDir = join(tmpdir(), `chatroom-test-${Date.now()}`);
  const tmpFile = join(tmpDir, 'opencode-sdk-sessions.json');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('get', () => {
    it('returns undefined for absent file', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('returns stored session by id', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);
      expect(store.get('sess-1')).toEqual(SAMPLE_META);
    });
  });

  describe('findByPid', () => {
    it('returns undefined for absent file', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      expect(store.findByPid(9999)).toBeUndefined();
    });

    it('finds session by pid', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);
      expect(store.findByPid(1234)).toEqual(SAMPLE_META);
    });
  });

  describe('upsert', () => {
    it('creates new file and stores session', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);
      expect(store.get('sess-1')).toEqual(SAMPLE_META);
    });

    it('overwrites existing session', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);
      const updated = { ...SAMPLE_META, baseUrl: 'http://127.0.0.1:9999' };
      store.upsert(updated);
      expect(store.get('sess-1')).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('is no-op for absent session', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      expect(() => store.remove('nonexistent')).not.toThrow();
    });

    it('removes stored session from file', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);
      store.remove('sess-1');
      expect(store.get('sess-1')).toBeUndefined();
    });
  });

  describe('nested path', () => {
    it('creates parent directories when upserting to a path with non-existent parents', () => {
      const nestedPath = join(tmpDir, `never-existed-${Date.now()}`, 'sessions.json');
      const store = new FileSessionMetadataStore(nestedPath);
      store.upsert(SAMPLE_META);
      expect(store.get('sess-1')).toEqual(SAMPLE_META);
    });
  });

  describe('backward compatibility', () => {
    it('preserves the on-disk JSON shape', () => {
      const store = new FileSessionMetadataStore(tmpFile);
      store.upsert(SAMPLE_META);

      const raw = readFileSync(tmpFile, 'utf-8');
      expect(JSON.parse(raw)).toBeTypeOf('object');
    });

    it('reads existing on-disk data', () => {
      const existing = { 'sess-old': { ...SAMPLE_META, sessionId: 'sess-old' } };
      writeFileSync(tmpFile, JSON.stringify(existing));

      const store = new FileSessionMetadataStore(tmpFile);
      expect(store.get('sess-old')).toEqual(existing['sess-old']);
    });
  });
});
