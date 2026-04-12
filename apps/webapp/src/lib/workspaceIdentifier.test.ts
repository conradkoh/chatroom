import { describe, expect, it } from 'vitest';

import {
  encodeWorkspaceId,
  decodeWorkspaceId,
  getWorkspaceDisplayName,
} from './workspaceIdentifier';

describe('encodeWorkspaceId / decodeWorkspaceId', () => {
  it('round-trips a typical machineId + workingDir', () => {
    const machineId = 'machine-abc-123';
    const workingDir = '/Users/alice/projects/chatroom';
    const encoded = encodeWorkspaceId(machineId, workingDir);
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded.machineId).toBe(machineId);
    expect(decoded.workingDir).toBe(workingDir);
  });

  it('round-trips with empty machineId', () => {
    const encoded = encodeWorkspaceId('', '/tmp/workspace');
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded.machineId).toBe('');
    expect(decoded.workingDir).toBe('/tmp/workspace');
  });

  it('round-trips with empty workingDir', () => {
    const encoded = encodeWorkspaceId('machine-1', '');
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded.machineId).toBe('machine-1');
    expect(decoded.workingDir).toBe('');
  });

  it('round-trips with non-ASCII characters (Unicode paths)', () => {
    const machineId = 'máquina-ñ';
    const workingDir = '/home/用户/プロジェクト';
    const encoded = encodeWorkspaceId(machineId, workingDir);
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded.machineId).toBe(machineId);
    expect(decoded.workingDir).toBe(workingDir);
  });

  it('round-trips when workingDir contains "::" (separator in value)', () => {
    const machineId = 'machine-1';
    const workingDir = '/path/with::double-colon/dir';
    const encoded = encodeWorkspaceId(machineId, workingDir);
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded.machineId).toBe(machineId);
    expect(decoded.workingDir).toBe(workingDir);
  });
});

describe('collision-proof', () => {
  it('produces different IDs for different machineIds with same workingDir', () => {
    const dir = '/Users/alice/chatroom';
    const id1 = encodeWorkspaceId('machine-a', dir);
    const id2 = encodeWorkspaceId('machine-b', dir);
    expect(id1).not.toBe(id2);
  });

  it('produces different IDs for same machineId with different workingDirs', () => {
    const machine = 'machine-1';
    const id1 = encodeWorkspaceId(machine, '/project-a');
    const id2 = encodeWorkspaceId(machine, '/project-b');
    expect(id1).not.toBe(id2);
  });

  it('produces identical IDs for identical inputs (deterministic)', () => {
    const id1 = encodeWorkspaceId('m', '/d');
    const id2 = encodeWorkspaceId('m', '/d');
    expect(id1).toBe(id2);
  });
});

describe('URL-safety', () => {
  it('contains only base64url characters (A-Z, a-z, 0-9, -, _)', () => {
    const encoded = encodeWorkspaceId(
      'long-machine-id-with-special-chars',
      '/Users/someone/very/deeply/nested/path/to/project'
    );
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('has no padding characters (=)', () => {
    // Test several inputs of different lengths to cover padding edge cases
    const inputs = [
      ['a', 'b'],
      ['ab', 'cd'],
      ['abc', 'def'],
      ['abcd', 'efgh'],
    ] as const;
    for (const [m, w] of inputs) {
      const encoded = encodeWorkspaceId(m, w);
      expect(encoded).not.toContain('=');
    }
  });

  it('has no + or / characters (standard base64 chars)', () => {
    const encoded = encodeWorkspaceId('machine+id', '/path/to/dir');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

describe('decodeWorkspaceId error handling', () => {
  it('throws on completely invalid base64', () => {
    expect(() => decodeWorkspaceId('!!!invalid!!!')).toThrow('Invalid workspace ID');
  });

  it('throws when separator is missing (valid base64 but no ::)', () => {
    // btoa('noseparator') without any :: in the content
    const encoded = btoa('noseparator').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeWorkspaceId(encoded)).toThrow('missing separator');
  });
});

describe('getWorkspaceDisplayName', () => {
  it('returns the last path segment', () => {
    expect(getWorkspaceDisplayName('/Users/alice/chatroom')).toBe('chatroom');
  });

  it('handles trailing slashes', () => {
    expect(getWorkspaceDisplayName('/Users/alice/chatroom/')).toBe('chatroom');
    expect(getWorkspaceDisplayName('/Users/alice/chatroom///')).toBe('chatroom');
  });

  it('returns the name as-is if no slash', () => {
    expect(getWorkspaceDisplayName('chatroom')).toBe('chatroom');
  });

  it('returns empty string for root path', () => {
    expect(getWorkspaceDisplayName('/')).toBe('');
  });

  it('handles deeply nested paths', () => {
    expect(getWorkspaceDisplayName('/a/b/c/d/my-project')).toBe('my-project');
  });

  it('returns empty string for empty input', () => {
    expect(getWorkspaceDisplayName('')).toBe('');
  });
});
