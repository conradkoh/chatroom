/**
 * List chatroom history
 */

import { listChatroomHistory } from '../infrastructure/history/storage.js';

export async function listChatrooms(): Promise<void> {
  const history = await listChatroomHistory();

  if (history.length === 0) {
    console.log('No chatrooms found in history.');
    console.log('Run `chatroom create` to create a new chatroom.');
    return;
  }

  console.log('\n📋 Chatroom History\n');
  console.log('─'.repeat(80));

  for (const entry of history) {
    console.log(`ID:        ${entry.chatroomId}`);
    console.log(`Team:      ${entry.teamName} (${entry.teamRoles.join(', ')})`);
    console.log(`Created:   ${new Date(entry.createdAt).toLocaleString()}`);
    console.log('─'.repeat(80));
  }

  console.log(`\nTotal: ${history.length} chatroom(s)`);
}
