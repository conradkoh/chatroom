#!/usr/bin/env bash
# Inspect scheduled prompt state for a chatroom on the current Convex dev deployment.
#
# Usage:
#   ./scripts/investigate-scheduled-prompt.sh <chatroom-id> [prompt-id]
#
# Examples:
#   ./scripts/investigate-scheduled-prompt.sh n57ctdnfvd0avh0ghx6p4szk8x8aa69a
#   ./scripts/investigate-scheduled-prompt.sh n57ctdnfvd0avh0ghx6p4szk8x8aa69a gd7te6pjzs18vzms0ty21pjmdh8b8jbz
#
# Requires: run from repo root with services/backend Convex dev configured.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHATROOM_ID="${1:-}"
PROMPT_ID="${2:-}"

if [[ -z "$CHATROOM_ID" ]]; then
  echo "Usage: $0 <chatroom-id> [prompt-id]" >&2
  exit 1
fi

# Convex inline queries cannot receive CLI args; embed IDs in the query string.
escape_js_string() {
  node -e "console.log(JSON.stringify(process.argv[1]))" "$1"
}

CHATROOM_ID_JS=$(escape_js_string "$CHATROOM_ID")
PROMPT_ID_JS=$(escape_js_string "$PROMPT_ID")

cd "$ROOT_DIR/services/backend"

INLINE_QUERY=$(cat <<QUERY_END
const chatroomId = ${CHATROOM_ID_JS};
const promptIdFilter = ${PROMPT_ID_JS} || null;
const now = Date.now();

function fmt(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const sgt = d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const uiMinute = d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    iso: d.toISOString(),
    sgt,
    uiMinute,
    second: d.getSeconds(),
    subMinuteMs: ms % 60_000,
  };
}

const chatroom = await ctx.db.get(chatroomId);
const prompts = await ctx.db
  .query("chatroom_scheduledPrompts")
  .withIndex("by_chatroom", (q) => q.eq("chatroomId", chatroomId))
  .collect();

const filtered = promptIdFilter
  ? prompts.filter((p) => p._id === promptIdFilter)
  : prompts;

const messages = await ctx.db
  .query("chatroom_messages")
  .withIndex("by_chatroom", (q) => q.eq("chatroomId", chatroomId))
  .order("desc")
  .take(50);

const scheduledMessages = messages
  .filter((m) => m.sourcePlatform === "scheduled")
  .slice(0, 15)
  .map((m) => ({
    id: m._id,
    scheduledPromptId: m.scheduledPromptId,
    created: fmt(m._creationTime),
    content: (m.content ?? "").slice(0, 60),
  }));

const queue = await ctx.db
  .query("chatroom_messageQueue")
  .withIndex("by_chatroom", (q) => q.eq("chatroomId", chatroomId))
  .collect();

const promptAnalysis = filtered.map((p) => {
  const isDue = p.isRunnable && p.nextRunAt != null && p.nextRunAt <= now;
  const next = fmt(p.nextRunAt);
  const cronNote =
    next && next.second > 0
      ? "Cron runs at :00; due only after " + next.sgt + " (UI shows " + next.uiMinute + ")"
      : null;
  return {
    id: p._id,
    prompt: p.prompt,
    scheduleKind: p.scheduleKind,
    intervalMinutes: p.intervalMinutes,
    isRunnable: p.isRunnable,
    disabledReason: p.disabledReason,
    isDue,
    msUntilNext: p.nextRunAt != null ? p.nextRunAt - now : null,
    nextRun: next,
    lastRun: fmt(p.lastRunAt),
    created: fmt(p.createdAt),
    updated: fmt(p.updatedAt),
    cronAlignmentNote: cronNote,
  };
});

return {
  queriedAt: fmt(now),
  chatroom: chatroom
    ? { id: chatroom._id, status: chatroom.status, title: chatroom.title }
    : null,
  promptCount: prompts.length,
  prompts: promptAnalysis,
  messageQueueSize: queue.length,
  recentScheduledMessages: scheduledMessages,
  hints: [
    "UI formatTime() shows HH:MM only — seconds are hidden.",
    "fireOne() uses computeNextRunAt (not computeNextRunAtForEnable), so post-fire nextRunAt keeps sub-minute offsets.",
    "Cron runs every 1 minute; a prompt with nextRunAt :36 appears due only after that second passes.",
    "Manual trigger: npx convex run scheduledPrompts:runDue '{}'",
  ],
};
QUERY_END
)

echo "=== Scheduled prompt investigation ==="
echo "Chatroom: $CHATROOM_ID"
[[ -n "$PROMPT_ID" ]] && echo "Prompt filter: $PROMPT_ID"
echo

npx convex run --inline-query "$INLINE_QUERY"
