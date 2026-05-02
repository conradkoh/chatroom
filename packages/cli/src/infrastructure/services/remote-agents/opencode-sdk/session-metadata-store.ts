import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface SessionMetadata {
  sessionId: string;
  machineId: string;
  chatroomId: string;
  role: string;
  pid: number;
  createdAt: string;
  baseUrl: string;
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

  private save(sessions: SessionRecord): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(sessions, null, 2));
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
