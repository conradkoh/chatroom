import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Persisted fields needed to reconnect after user stop (no baseUrl — new serve on resume). */
export interface ResumeSnapshot {
  sessionId: string;
  machineId: string;
  chatroomId: string;
  role: string;
  agentName: string;
  model?: string;
  workingDir: string;
  updatedAt: string;
}

export function resumeSnapshotKey(machineId: string, chatroomId: string, role: string): string {
  return `${machineId}:${chatroomId}:${role}`;
}

export interface ResumeSnapshotStore {
  get(machineId: string, chatroomId: string, role: string): ResumeSnapshot | undefined;
  upsert(snapshot: ResumeSnapshot): void;
  remove(machineId: string, chatroomId: string, role: string): void;
}

type SnapshotRecord = Record<string, ResumeSnapshot>;

export class InMemoryResumeSnapshotStore implements ResumeSnapshotStore {
  private snapshots: SnapshotRecord = {};

  get(machineId: string, chatroomId: string, role: string): ResumeSnapshot | undefined {
    return this.snapshots[resumeSnapshotKey(machineId, chatroomId, role)];
  }

  upsert(snapshot: ResumeSnapshot): void {
    const key = resumeSnapshotKey(snapshot.machineId, snapshot.chatroomId, snapshot.role);
    this.snapshots[key] = snapshot;
  }

  remove(machineId: string, chatroomId: string, role: string): void {
    delete this.snapshots[resumeSnapshotKey(machineId, chatroomId, role)];
  }
}

export class FileResumeSnapshotStore implements ResumeSnapshotStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? join(homedir(), '.chatroom', 'opencode-sdk-resume-snapshots.json');
  }

  private load(): SnapshotRecord {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      // Ignore errors, return empty object
    }
    return {};
  }

  private save(snapshots: SnapshotRecord): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(snapshots, null, 2));
    } catch {
      // Ignore errors for now
    }
  }

  get(machineId: string, chatroomId: string, role: string): ResumeSnapshot | undefined {
    return this.load()[resumeSnapshotKey(machineId, chatroomId, role)];
  }

  upsert(snapshot: ResumeSnapshot): void {
    const snapshots = this.load();
    snapshots[resumeSnapshotKey(snapshot.machineId, snapshot.chatroomId, snapshot.role)] =
      snapshot;
    this.save(snapshots);
  }

  remove(machineId: string, chatroomId: string, role: string): void {
    const snapshots = this.load();
    delete snapshots[resumeSnapshotKey(machineId, chatroomId, role)];
    this.save(snapshots);
  }
}
