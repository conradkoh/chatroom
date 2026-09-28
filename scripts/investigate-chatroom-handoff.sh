#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHATROOM_ID="${1:-}"

if [[ -z "$CHATROOM_ID" ]]; then
  echo "Usage: $0 <chatroom-id>" >&2
  exit 1
fi

escape_js_string() {
  node -e "console.log(JSON.stringify(process.argv[1]))" "$1"
}

CHATROOM_ID_JS="$(escape_js_string "$CHATROOM_ID")"
cd "$ROOT_DIR/services/backend"

INLINE_QUERY=$(cat <<QUERY_END
const chatroomId = ${CHATROOM_ID_JS};
const chatroom = await ctx.db.get(chatroomId);
if (!chatroom) return { chatroom: null, messages: [], readModels: [], tasks: [] };

const messages = await ctx.db
  .query("chatroom_messages")
  .withIndex("by_chatroom", (q) => q.eq("chatroomId", chatroomId))
  .order("desc")
  .take(50);
const readModels = await ctx.db
  .query("chatroom_messageReadModels")
  .withIndex("by_chatroom_createdAt", (q) => q.eq("chatroomId", chatroomId))
  .order("desc")
  .take(50);
const tasks = await ctx.db
  .query("chatroom_tasks")
  .withIndex("by_chatroom", (q) => q.eq("chatroomId", chatroomId))
  .order("desc")
  .take(100);
const messageIds = new Set(messages.map((message) => message._id));

return {
  chatroom: { id: chatroom._id, status: chatroom.status, name: chatroom.name ?? null },
  messages: messages.map((message) => ({
    id: message._id,
    createdAt: message._creationTime,
    senderRole: message.senderRole,
    targetRole: message.targetRole ?? null,
    type: message.type,
    taskId: message.taskId ?? null,
    contentPreview: message.content.slice(0, 240),
  })),
  readModels: readModels.map((row) => ({
    messageId: row.messageId,
    messageCreatedAt: row.messageCreatedAt,
    senderRole: row.senderRole,
    type: row.type,
    taskId: row.taskId ?? null,
    taskStatus: row.taskStatus ?? null,
  })),
  tasks: tasks
    .filter(
      (task) =>
        (task.sourceMessageId && messageIds.has(task.sourceMessageId)) ||
        (task.createdBy.toLowerCase() === "planner" &&
          task.assignedTo?.toLowerCase() === "architect")
    )
    .map((task) => ({
      id: task._id,
      createdBy: task.createdBy,
      assignedTo: task.assignedTo ?? null,
      sourceMessageId: task.sourceMessageId ?? null,
      status: task.status,
      contentPreview: task.content.slice(0, 240),
    })),
};
QUERY_END
)

echo "=== Chatroom handoff inspection ==="
echo "Chatroom: $CHATROOM_ID"
echo "Deployment: Convex CLI's configured development deployment"
echo
npx convex run --inline-query "$INLINE_QUERY"
