import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface SessionMetadata {
  sessionId: string;
  machineId: string;
  chatroomId: string;
  role: string;
  /** OpenCode agent id selected at spawn (required for session re-creation fallback). */
  agentName: string;
  /** Model id string passed at spawn, if any (e.g. provider/model). */
  model?: string | undefined;
  /**
   * Working directory the session was spawned in. Persisted so the resume fallback
   * can recreate the session in the same OpenCode location after a daemon restart.
   * Absent on metadata written by older versions.
   */
  workingDir?: string | undefined;
  /** Composed system prompt deferred until first resumeTurn (idle native spawn). */
  deferredSystemPrompt?: string | undefined;
  /** Display title synced from the harness (e.g. opencode session title). */
  title?: string | undefined;
  pid: number;
  createdAt: string;
  baseUrl: string;
  /** Basic-auth password for the spawned `opencode serve`, when printed. */
  password?: string | undefined;
}

export interface SessionMetadataStore {
  get(sessionId: string): SessionMetadata | undefined;
  findByPid(pid: number): SessionMetadata | undefined;
  upsert(meta: SessionMetadata): void;
  remove(sessionId: string): void;
}

type SessionRecord = Record<string, SessionMetadata>;

export class InMemorySessionMetadataStore implements SessionMetadataStore {
  private sessions: SessionRecord = {};

  get(sessionId: string): SessionMetadata | undefined {
    return this.sessions[sessionId];
  }

  findByPid(pid: number): SessionMetadata | undefined {
    return Object.values(this.sessions).find((m) => m.pid === pid);
  }

  upsert(meta: SessionMetadata): void {
    this.sessions[meta.sessionId] = meta;
  }

  remove(sessionId: string): void {
    delete this.sessions[sessionId];
  }
}

export class FileSessionMetadataStore implements SessionMetadataStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.chatroom', 'opencode-sdk-sessions.json');
  }

  private load(): SessionRecord {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      // Ignore errors, return empty object
    }
    return {};
  }

  /**
   * Persists all sessions. The file holds the plaintext server password, so it is
   * owner-only (0600) and its directory is owner-only (0700).
   * Constraint: `mode` only applies on creation, so chmodSync also tightens files
   * written by older versions with 0644.
   */
  private save(sessions: SessionRecord): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(this.filePath, JSON.stringify(sessions, null, 2), { mode: 0o600 });
      chmodSync(this.filePath, 0o600);
    } catch {
      // Ignore errors for now
    }
  }

  get(sessionId: string): SessionMetadata | undefined {
    return this.load()[sessionId];
  }

  findByPid(pid: number): SessionMetadata | undefined {
    const sessions = this.load();
    return Object.values(sessions).find((m) => m.pid === pid);
  }

  upsert(meta: SessionMetadata): void {
    const sessions = this.load();
    sessions[meta.sessionId] = meta;
    this.save(sessions);
  }

  remove(sessionId: string): void {
    const sessions = this.load();
    delete sessions[sessionId];
    this.save(sessions);
  }
}
