import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  contentOf,
  sha256Hex,
  TRANSFER_ERROR_CODES,
  type ChatroomExportFileV1,
} from './chatroom-transfer-file';

describe('canonicalJson', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 'x'] } })).toBe(
      '{"a":{"c":[3,"x"],"d":2},"b":1}'
    );
  });
  it('drops undefined object properties', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it('writes undefined array items as null', () => {
    expect(canonicalJson([1, undefined])).toBe('[1,null]');
  });
  it('throws on NaN and Infinity', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow('non-finite');
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow('non-finite');
  });
  it('throws on non-plain objects', () => {
    expect(() => canonicalJson({ d: new Date(0) })).toThrow('non-plain');
    class Row {
      x = 1;
    }
    expect(() => canonicalJson(new Row())).toThrow('non-plain');
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
  it('returns 64 lowercase hex characters', async () => {
    expect(await sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('contentOf', () => {
  it('returns exactly the 12 content properties', () => {
    const file: ChatroomExportFileV1 = {
      formatVersion: 1,
      kind: 'chatroom-export',
      exportedAt: '2026-01-01T00:00:00.000Z',
      source: { chatroomId: 'room-1', cliVersion: '1.0.0' },
      omitted: {},
      checksum: 'deadbeef',
      room: { _key: 'r1', _creationTime: 0 },
      workspaces: [],
      agentConfigs: [],
      messages: [],
      messageQueue: [],
      tasks: [],
      backlog: [],
      artifacts: [],
      contexts: [],
      scheduledPrompts: [],
      savedCommands: [],
      skillCustomizations: [],
    };

    expect(Object.keys(contentOf(file)).sort()).toEqual(
      [
        'agentConfigs',
        'artifacts',
        'backlog',
        'contexts',
        'messageQueue',
        'messages',
        'room',
        'savedCommands',
        'scheduledPrompts',
        'skillCustomizations',
        'tasks',
        'workspaces',
      ].sort()
    );
    expect(contentOf(file)).not.toHaveProperty('checksum');
    expect(contentOf(file)).not.toHaveProperty('omitted');
  });
});

describe('TRANSFER_ERROR_CODES', () => {
  it('maps every key to itself', () => {
    for (const [key, value] of Object.entries(TRANSFER_ERROR_CODES)) expect(value).toBe(key);
  });
});
