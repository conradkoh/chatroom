import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HISTORY_DIR = join(homedir(), '.chatroom', 'history');
const HISTORY_FILE = 'chatrooms.json';

interface ChatroomHistoryEntry {
  chatroomId: string;
  teamId: string;
  teamName: string;
  teamRoles: string[];
  createdAt: string;
}

/**
 * Ensure the history directory exists
 */
function ensureHistoryDir(): void {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Get the path to the history file
 */
function getHistoryPath(): string {
  return join(HISTORY_DIR, HISTORY_FILE);
}

/**
 * Load the chatroom history
 */
export async function listChatroomHistory(): Promise<ChatroomHistoryEntry[]> {
  const historyPath = getHistoryPath();

  if (!existsSync(historyPath)) {
    return [];
  }

  try {
    const content = readFileSync(historyPath, 'utf-8');
    return JSON.parse(content) as ChatroomHistoryEntry[];
  } catch {
    console.warn('Warning: Could not read chatroom history');
    return [];
  }
}

/**
 * Save a chatroom to the history
 */
export async function saveChatroomHistory(entry: ChatroomHistoryEntry): Promise<void> {
  ensureHistoryDir();

  const history = await listChatroomHistory();
  history.unshift(entry); // Add to beginning

  // Keep only the last 100 entries
  const trimmedHistory = history.slice(0, 100);

  const historyPath = getHistoryPath();
  writeFileSync(historyPath, JSON.stringify(trimmedHistory, null, 2), 'utf-8');
}

/**
 * Get the most recent chatroom from history
 */
export async function getMostRecentChatroom(): Promise<ChatroomHistoryEntry | null> {
  const history = await listChatroomHistory();
  return history.length > 0 ? history[0]! : null;
}
