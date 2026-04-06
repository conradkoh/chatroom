# DB Bandwidth Optimization Plan

**Branch:** `fix/db-bandwidth-optimization` -> `release/v1.22.1`
**PR:** #288
**Backlog Item:** ps7d7hke6y9f1ex1hv0071c0px84bggq
**Total estimated daily bandwidth:** ~55 GB/day for 2 machines
**Target:** Reduce to <15 GB/day

---

## Phase 1: Tier 1 Quick Wins (~25 GB savings)

### Fix 1: Separate Machine Liveness Table
- **Status:** [ ] TODO
- **Functions affected:** daemonHeartbeat (1.5GB + ~15GB cascade), listMachines (2GB), listWorkspacesForChatroom (1.3GB)
- **Root cause:** `daemonHeartbeat` writes `lastSeenAt`/`daemonConnected` to `chatroom_machines`, triggering all machine-reading subscriptions
- **Fix:** Create `chatroom_machineLiveness` table with `lastSeenAt`, `daemonConnected`. Move heartbeat writes there. Static machine queries no longer re-trigger.
- **Est savings:** ~15 GB/day (cascade elimination)

### Fix 2: Materialized Task Counts
- **Status:** [ ] TODO
- **Functions affected:** tasks.getTaskCounts (10.5GB)
- **Root cause:** `.collect()` reads ALL task documents just to count them
- **Fix:** Create `chatroom_taskCounts` table. Increment/decrement counts in task status mutations. Query becomes single doc read.
- **Est savings:** ~10 GB/day

### Fix 3: Per-Chatroom Unread Flag
- **Status:** [ ] TODO
- **Functions affected:** chatrooms.listUnreadStatus (10GB)
- **Root cause:** Global subscription + N+1 per chatroom with 10 messages read each
- **Fix:** Store `hasUnread`/`hasUnreadHandoff` flags on chatroom or read cursor. Update flags on message insert + cursor update. Listing query becomes single table scan.
- **Est savings:** ~9 GB/day

### Fix 4: Use Proper Index for Backlog Listing
- **Status:** [ ] TODO
- **Functions affected:** backlog.listBacklogItems (6GB)
- **Root cause:** Uses `by_chatroom` + JS filter instead of `by_chatroom_status` index; 3 overlapping subscriptions
- **Fix:** Use `by_chatroom_status` index for direct status-filtered queries. Add `.take()` limits.
- **Est savings:** ~4 GB/day

---

## Phase 2: Tier 2 Medium Wins (~10 GB savings)

### Fix 5: Cursor-Based Event Stream
- **Status:** [ ] TODO
- **Functions affected:** machines.getCommandEvents (5GB)
- **Root cause:** 7 queries per call, no TTL on some, all re-evaluate on any event
- **Fix:** Cursor-based approach + TTL cleanup for old events

### Fix 6: Compressed/Delta File Tree Sync
- **Status:** [ ] TODO
- **Functions affected:** workspaceFiles.syncFileTree (3.8GB+1.2GB write)
- **Root cause:** Full tree blob replace on every change
- **Fix:** Hash-based change detection at read level; compress treeJson

### Fix 7: Atomic Counter for messagesSinceContext
- **Status:** [ ] TODO
- **Functions affected:** tasks.readTask (3.5GB)
- **Root cause:** Scans all messages since context to count them
- **Fix:** Use `chatroom.messageCount - context.messageCountAtCreation`

### Fix 8: Merge Duplicate Agent Queries
- **Status:** [ ] TODO
- **Functions affected:** getAgentStatus + getMachineAgentConfigs (5GB combined)
- **Root cause:** Two nearly identical queries reading same data
- **Fix:** Merge into single query

---

## Phase 3: Tier 3 Smaller Wins (~5 GB savings)

### Fix 9-15: Remaining optimizations
- listAgentOverview (2.8GB) — per-chatroom sub
- messages.listPaginated (1.4GB) — denormalize task status
- listParticipantPresence (1GB) — per-chatroom sub
- getFileTree (800MB) — content hash + conditional fetch
- getMissingCommitShas (700MB) — lightweight SHA index
