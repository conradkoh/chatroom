import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TAIL_WINDOW_BYTES = 32 * 1024;
const TEMP_DIR = join(tmpdir(), 'chatroom-cli', 'runs');
const RUN_ID_RE = /^[a-z0-9]+$/i;

export interface OutputStore {
  append(data: string): Promise<void>;
  getTail(): { content: string; totalBytes: number };
  getFullOutput(): Promise<string>;
  destroy(): Promise<void>;
}

interface InternalState {
  filePath: string;
  inMemory: string;
  totalBytes: number;
}

class TempFileOutputStore implements OutputStore {
  private state: InternalState;

  constructor(filePath: string) {
    this.state = {
      filePath,
      inMemory: '',
      totalBytes: 0,
    };
  }

  async append(data: string): Promise<void> {
    const { filePath } = this.state;
    this.state.inMemory += data;
    this.state.totalBytes += Buffer.byteLength(data, 'utf-8');

    if (this.state.inMemory.length > TAIL_WINDOW_BYTES) {
      this.state.inMemory = this.state.inMemory.slice(-TAIL_WINDOW_BYTES);
    }

    try {
      await appendFile(filePath, data, 'utf-8');
    } catch (err) {
      // Temp file write failure is non-fatal — in-memory tail still works
    }
  }

  getTail(): { content: string; totalBytes: number } {
    return {
      content: this.state.inMemory,
      totalBytes: this.state.totalBytes,
    };
  }

  async getFullOutput(): Promise<string> {
    try {
      return await readFile(this.state.filePath, 'utf-8');
    } catch {
      return this.state.inMemory;
    }
  }

  async destroy(): Promise<void> {
    try {
      await rm(this.state.filePath, { force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

export function createOutputStore(runId: string): OutputStore {
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid runId: ${runId}`);
  }
  const filePath = join(TEMP_DIR, `${runId}.log`);
  return new TempFileOutputStore(filePath);
}

export async function ensureTempDir(): Promise<void> {
  await mkdir(TEMP_DIR, { recursive: true });
}

export async function cleanOrphanTempFiles(): Promise<void> {
  try {
    await rm(TEMP_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist — that's fine
  }
}
