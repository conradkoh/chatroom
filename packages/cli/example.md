cmdand heredoc> ### Cassandra
cmdand heredoc>
cmdand heredoc> - Multi-master architecture with eventual consistency
cmdand heredoc> - Tunable consistency levels (ONE, QUORUM, ALL)
cmdand heredoc> - Uses Merkle trees for replica synchronization
cmdand heredoc> - Implements read repair and anti-entropy
cmdand heredoc>
cmdand heredoc> ### DNS
cmdand heredoc>
cmdand heredoc> - Classic example of eventual consistency
cmdand heredoc> - Changes propagate through DNS hierarchy
cmdand heredoc> - TTL (Time To Live) controls cache invalidation
cmdand heredoc> - Updates can take hours to propagate globally
cmdand heredoc>
cmdand heredoc> ## Best Practices
cmdand heredoc>
cmdand heredoc> ### Design Principles
cmdand heredoc>
cmdand heredoc> 1. **Idempotent Operations**: Design operations that can be safely retried
cmdand heredoc> 2. **Conflict-Aware APIs**: Build APIs that can handle version conflicts
cmdand heredoc> 3. **Compensation Logic**: Implement ways to undo or compensate for operations
cmdand heredoc> 4. **Monitoring**: Track consistency lag and convergence times
cmdand heredoc> 5. **Testing**: Test for network partitions and concurrent updates
cmdand heredoc>
cmdand heredoc> ### Operational Considerations
cmdand heredoc>
cmdand heredoc> 1. **Consistency Metrics**: Monitor time to convergence
cmdand heredoc> 2. **Conflict Rates**: Track frequency and types of conflicts
cmdand heredoc> 3. **Replica Health**: Monitor replica synchronization status
cmdand heredoc> 4. **Network Latency**: Measure propagation delays
cmdand heredoc> 5. **Data Validation**: Regular consistency checks
cmdand heredoc>
cmdand heredoc> ## Common Pitfalls
cmdand heredoc>
cmdand heredoc> 1. **Assuming Immediate Consistency**: Writing code as if updates are instantly visible
cmdand heredoc> 2. **Ignoring Conflicts**: Not handling concurrent updates properly
cmdand heredoc> 3. **Poor Error Handling**: Not accounting for temporary inconsistencies
cmdand heredoc> 4. **Insufficient Testing**: Not testing failure scenarios
cmdand heredoc> 5. **Complex State Management**: Creating overly complex conflict resolution
cmdand heredoc>
cmdand heredoc> ## Conclusion
cmdand heredoc>
cmdand heredoc> Eventual consistency is a powerful model for building scalable, highly available distributed systems. While it introduces complexity in handling temporary inconsistencies, it enables systems to remain operational even during network partitions and failures.
cmdand heredoc>
cmdand heredoc> The key to successful implementation is understanding the trade-offs, designing for inconsistency, and implementing robust conflict resolution mechanisms. When applied appropriately, eventual consistency can significantly improve system performance and availability.
cmdand heredoc>
cmdand heredoc> ## Further Reading
cmdand heredoc>
cmdand heredoc> - "Designing Data-Intensive Applications" by Martin Kleppmann
cmdand heredoc> - "Distributed Systems: Principles and Paradigms" by Tanenbaum & Van Steen
cmdand heredoc> - CAP Theorem and its implications
cmdand heredoc> - Dynamo paper (Amazon)
cmdand heredoc> - Bigtable paper (Google)
cmdand heredoc> EOF

CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="$MSG_FILE" --next-role=user
%                                                                                                                                                                                                                                                                                                                               
conradkoh@Mac chatroom % 
%                                                                                                                                                                                                                                                                                                                               
conradkoh@Mac chatroom % CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="$MSG_FILE" --next-role=user
✅ Task completed and handed off to user
📋 Summary: # Eventual Consistency: A Comprehensive Guide

## Overview

Eventual consistency is a consistency mo...

🎉 Workflow complete! Control returned to user.

⏳ Now run wait-for-task to wait for your next assignment:
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --session=1
%  
conradkoh@Mac chatroom % CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
[CONVEX M(participants:join)] [WARN] '[State Recovery] chatroomId=jx7f2bjgr49hw338mytn1vz2857zsgx4 role=builder taskId=k1752qqa4x79ypfnep5be629ph7zsxyn action=reset_to_pending reason=agent_rejoined'
✅ Joined chatroom as "builder"

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

You are joining a multi-agent chatroom as the **BUILDER** role.

## Chatroom Information

- **Chatroom ID:** `jx7f2bjgr49hw338mytn1vz2857zsgx4`
- **Team:** Pair (builder, reviewer)
- **Your Role:** builder

## Your Responsibilities

You are the implementer responsible for writing code and building solutions.

As the Builder, you are responsible for:

- Implement solutions based on requirements
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices
- Handle edge cases and error scenarios
- Provide clear summaries of what was built

## Getting Started

Run this command to join the chatroom and wait for instructions:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

## Workflow

1. The command above will wait until you receive a message
2. When you receive a message, read it carefully and perform your task
3. When done, hand off to the next agent using the handoff command
4. The command will **automatically wait** for your next assignment

## Acknowledging Tasks (Classification)

When you receive a user message, you MUST first acknowledge it and classify what type of request it is:

```bash
# Use explicit message ID (recommended - provided by wait-for-task)
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type> --message-id=<messageId>

# Or use task ID if no message ID is available
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type> --task-id=<taskId>

# Legacy fallback (finds latest unclassified message - not recommended)
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type>
```

### Classification Types

| Type          | Description                           | Workflow                                        |
| ------------- | ------------------------------------- | ----------------------------------------------- |
| `question`    | User is asking a question             | Can respond directly to user                    |
| `new_feature` | User wants new functionality built    | Must go through review before returning to user |
| `follow_up`   | User is following up on previous task | Same rules as the original task                 |

### New Feature Classification

When classifying a message as `new_feature`, you MUST provide metadata via files:

```bash
# Write description and tech specs to files with unique IDs
mkdir -p tmp/chatroom
UNIQUE_ID=$(date +%s%N)
DESC_FILE="tmp/chatroom/description-$UNIQUE_ID.md"
SPECS_FILE="tmp/chatroom/tech-specs-$UNIQUE_ID.md"
echo "Implement JWT-based authentication with login/logout flow" > "$DESC_FILE"
echo "Use bcrypt for password hashing. JWT tokens expire after 24h." > "$SPECS_FILE"

chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=new_feature \
  --message-id=<messageId> \
  --title="Add user authentication" \
  --description-file="$DESC_FILE" \
  --tech-specs-file="$SPECS_FILE"
```

**Format Requirements:**

- `--title`: Plain text only (no markdown)
- `--description-file`: Path to file with markdown formatted description
- `--tech-specs-file`: Path to file with markdown formatted technical specifications

### Example

```bash
# Write your handoff message to a file with unique ID
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "## Implementation Complete

Added user authentication with:
- JWT tokens
- Password hashing
- Session management" > "$MSG_FILE"

# Hand off to next role
chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer
```

**Note:** All content is passed via files to avoid shell escape sequence issues.

**Important for Builders:**

- For `new_feature` requests, you CANNOT hand off directly to the user
- You MUST hand off to the reviewer first for review
- This ensures all new features are reviewed before delivery

## Communicating in the Chatroom

To complete your task and hand off to the next role:

```bash
# Write your message to a file with unique ID, then hand off
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Your handoff message here" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer
```

**Message Format:** Your handoff message should be formatted in markdown for readability. Use headers, bullet points, code blocks, and tables as appropriate.

Use this when:

- Your assigned task is complete
- You need to pass work to another role
- You need to ask the user for clarification (hand off to user with your question)

## Handoff Options

You can hand off to these roles:

- `reviewer`
- `user` - Returns control to the user (completes the workflow)

## Builder Workflow

You are responsible for implementing code changes based on requirements.

**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:

1. First run `chatroom task-started` to classify it (question, new_feature, or follow_up)
2. Then do your work
3. Hand off to reviewer for code changes, or directly to user for questions

**Typical Flow:**

1. Receive task (from user or handoff from reviewer)
2. Implement the requested changes
3. Commit your work with clear messages
4. Hand off to reviewer with a summary of what you built

**Handoff Rules:**

- **After code changes** → Hand off to `reviewer`
- **For simple questions** → Can hand off directly to `user`
- **For `new_feature` classification** → MUST hand off to `reviewer` (cannot skip review)

**When you receive handoffs from the reviewer:**
You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.

## Important Notes

- **Always hand off:** Every task must end with a handoff. To ask questions, hand off to user with your question.
- **Be thorough:** Include detailed summaries in your handoff messages so the next agent has full context
- **Format in Markdown:** Your handoff message content should be formatted in markdown for readability
- **Stay focused:** Complete your assigned task before handing off
- **Handle interrupts:** If you receive an interrupt message, stop work and exit gracefully
- **Restart immediately after unexpected termination:** If your `wait-for-task` process is killed (SIGTERM, SIGINT, timeout, or any other signal), immediately restart it. You will miss messages while not waiting.

## Context Window

When you receive a message, the JSON output includes a `context` section with:

- **originMessage**: The original user message that started this task chain (the latest non-follow-up message)
- **allMessages**: All messages from the origin message to now, including handoff messages

**Important:**

- You will see handoff messages between ALL agents, not just those targeted at you
- **Ignore handoff messages that are not targeted at your role** - they are included for context only
- Focus only on messages targeted at you or broadcast messages
- Use the full context to understand the task history and decisions made

## Waiting for Tasks

After completing any task (`handoff`), you **MUST** run wait-for-task:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

### Understanding Wait Sessions

**Wait-for-task is a finite but long task, not endless waiting.**

Each wait session lasts ~10 minutes. When a session completes:

- You'll see "COMPLETED WAIT SESSION" with remaining sessions
- This is **normal and expected** - completing sessions is progress
- Immediately start the next session by running the command again

Think of it like a guard on duty: you complete shifts (sessions), but your overall duty continues until relieved.

### Rules

- **You MUST ALWAYS run `wait-for-task` after every `handoff` command.**
- **You MUST ALWAYS run `wait-for-task` before ending your turn, without exception.**
- **When a session completes, immediately start the next one.**

### Why

Other agents may hand work back to you, or the user may have follow-up tasks. If you don't wait, you will miss messages and break the workflow.

### Workflow

1. Do your work
2. Run `handoff`
3. Run `wait-for-task`
4. When session completes, run `wait-for-task` again
5. Repeat until you receive a task

### Handling Session Completion

When you see "COMPLETED WAIT SESSION":

- This is SUCCESS, not a problem - completing sessions is progress
- The CLI will show the exact next command to run with the updated session number
- Immediately run that command to continue waiting

### Handling Unexpected Terminations

The `wait-for-task` process may terminate unexpectedly due to:

- **SIGTERM/SIGINT/SIGHUP** - External signals (e.g., timeout, container shutdown, manual kill)
- **Task cancellation** - The user cancelled the task

**IMPORTANT:** If the wait-for-task process terminates for ANY reason, you MUST immediately restart it:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

**Never leave the wait-for-task process stopped.** While you're not waiting, you will miss any messages sent to you by other agents or the user.

## Example Usage

```bash
# Ask for clarification (hand off to user with question)
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Can you clarify if you want a REST or GraphQL API?" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=user

# Wait for response
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

```bash
# Complete your task and hand off
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "## Summary

Implemented feature X with:
- Component A
- Component B" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer

# Wait for next assignment
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

══════════════════════════════════════════════════

⏳ Waiting for tasks (duration: 10m)...

──────────────────────────────────────────────────
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
──────────────────────────────────────────────────

<!--
Current Time: Jan 23, 2026, 12:51 AM
## Role
## Your Role: BUILDER

You are the implementer responsible for writing code and building solutions.

### Workflow

1. Receive task (from user or reviewer handoff)
2. Implement the requested changes
3. Commit your work with clear messages
4. Hand off to reviewer with a summary

### Current Task: QUESTION
User is asking a question. Can respond directly after answering.

### Handoff Options
Available targets: reviewer, user

### Commands

**Complete task and hand off:**
```
# Write message to file first:
# mkdir -p tmp/chatroom && echo "<summary>" > tmp/chatroom/message.md
chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="tmp/chatroom/message.md" \
  --next-role=<target>
```

**Always run after handoff:**
```
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

**⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), immediately restart it!**

## Command reference
**Handoff (complete task):**
```bash
chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="tmp/chatroom/message.md" --next-role=<target>
```

**Backlog:**
```bash
chatroom backlog list jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --status=active
```

**Wait for tasks:**
```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

## 📍 Pinned
### Primary User Directive
<user-message>
can you ask the reviewer to review it?
</user-message>

### Inferred Task (inferred from user directive)
Classification: question
-->

# Task Content

## New Message (addressed to you for processing)

<message>
From: builder
To: reviewer

## User Request

The user is asking you to review something. Please proceed with the review process.

**Note:** The user didn't specify what exactly needs to be reviewed, so you may need to ask for clarification if the context isn't clear from previous messages.

</message>

## Next Steps

1. Hand off to the next individual to start work by running `chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="tmp/chatroom/message.md" --next-role=reviewer`
2. Run `chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder` to wait for the next message. Remember: the user can only speak via the chatroom and receive info from there, so you need to always be waiting for tasks from the chatroom and sending your responses there.
   %  
   conradkoh@Mac chatroom % CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=question
   ❌ No unclassified user message found to acknowledge
   All user messages may already be classified.
   Use --message-id or --task-id to classify a specific message.
   %  
   conradkoh@Mac chatroom % MSG_FILE="tmp/chatroom/message-$(date +%s%N).md" && cat > "$MSG_FILE" << 'EOF'
   cmdand heredoc> ## Review Request: Eventual Consistency Documentation
   cmdand heredoc>
   cmdand heredoc> I've just completed a comprehensive documentation on eventual consistency as requested by the user. Please review the following aspects:
   cmdand heredoc>
   cmdand heredoc> ### Content Review
   cmdand heredoc> - **Technical Accuracy**: Verify the concepts, examples, and implementation patterns
   cmdand heredoc> - **Completeness**: Ensure all key aspects of eventual consistency are covered
   cmdand heredoc> - **Clarity**: Check if explanations are clear and easy to understand
   cmdand heredoc> - **Structure**: Evaluate the organization and flow of information
   cmdand heredoc>
   cmdand heredoc> ### Specific Areas to Focus On
   cmdand heredoc> 1. **Core Concepts**: Are the definitions and explanations accurate?
   cmdand heredoc> 2. **Code Examples**: Do the TypeScript examples demonstrate the concepts correctly?
   cmdand heredoc> 3. **Trade-offs**: Are the advantages and disadvantages balanced?
   cmdand heredoc> 4. **Use Cases**: Are the examples appropriate and realistic?
   cmdand heredoc> 5. **Best Practices**: Are the recommendations sound and practical?
   cmdand heredoc>
   cmdand heredoc> ### Documentation Structure
   cmdand heredoc> - Overview and core concepts
   cmdand heredoc> - How it works with conflict resolution
   cmdand heredoc> - Trade-offs analysis
   cmdand heredoc> - When to use vs when not to use
   cmdand heredoc> - Implementation patterns with code examples
   cmdand heredoc> - Real-world examples (DynamoDB, Cassandra, DNS)
   cmdand heredoc> - Best practices and common pitfalls
   cmdand heredoc>
   cmdand heredoc> The user specifically requested this documentation and would like it reviewed before final delivery. Please provide feedback on any areas that need improvement or clarification.
   cmdand heredoc>
   cmdand heredoc> ### Next Steps
   cmdand heredoc> After your review, please hand back to me with any requested changes, or if approved, hand off to the user for final delivery.
   cmdand heredoc> EOF

CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="$MSG_FILE" --next-role=reviewer
%                                                                                                                                                                                                                                                                                                                               
conradkoh@Mac chatroom % 
%                                                                                                                                                                                                                                                                                                                               
conradkoh@Mac chatroom % CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --message-file="$MSG_FILE" --next-role=reviewer
✅ Task completed and handed off to reviewer
📋 Summary: ## Review Request: Eventual Consistency Documentation

I've just completed a comprehensive documenta...

⏳ Now run wait-for-task to wait for your next assignment:
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --session=1
%  
conradkoh@Mac chatroom % CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
✅ Joined chatroom as "builder"

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

You are joining a multi-agent chatroom as the **BUILDER** role.

## Chatroom Information

- **Chatroom ID:** `jx7f2bjgr49hw338mytn1vz2857zsgx4`
- **Team:** Pair (builder, reviewer)
- **Your Role:** builder

## Your Responsibilities

You are the implementer responsible for writing code and building solutions.

As the Builder, you are responsible for:

- Implement solutions based on requirements
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices
- Handle edge cases and error scenarios
- Provide clear summaries of what was built

## Getting Started

Run this command to join the chatroom and wait for instructions:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

## Workflow

1. The command above will wait until you receive a message
2. When you receive a message, read it carefully and perform your task
3. When done, hand off to the next agent using the handoff command
4. The command will **automatically wait** for your next assignment

## Acknowledging Tasks (Classification)

When you receive a user message, you MUST first acknowledge it and classify what type of request it is:

```bash
# Use explicit message ID (recommended - provided by wait-for-task)
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type> --message-id=<messageId>

# Or use task ID if no message ID is available
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type> --task-id=<taskId>

# Legacy fallback (finds latest unclassified message - not recommended)
chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=<type>
```

### Classification Types

| Type          | Description                           | Workflow                                        |
| ------------- | ------------------------------------- | ----------------------------------------------- |
| `question`    | User is asking a question             | Can respond directly to user                    |
| `new_feature` | User wants new functionality built    | Must go through review before returning to user |
| `follow_up`   | User is following up on previous task | Same rules as the original task                 |

### New Feature Classification

When classifying a message as `new_feature`, you MUST provide metadata via files:

```bash
# Write description and tech specs to files with unique IDs
mkdir -p tmp/chatroom
UNIQUE_ID=$(date +%s%N)
DESC_FILE="tmp/chatroom/description-$UNIQUE_ID.md"
SPECS_FILE="tmp/chatroom/tech-specs-$UNIQUE_ID.md"
echo "Implement JWT-based authentication with login/logout flow" > "$DESC_FILE"
echo "Use bcrypt for password hashing. JWT tokens expire after 24h." > "$SPECS_FILE"

chatroom task-started jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder --origin-message-classification=new_feature \
  --message-id=<messageId> \
  --title="Add user authentication" \
  --description-file="$DESC_FILE" \
  --tech-specs-file="$SPECS_FILE"
```

**Format Requirements:**

- `--title`: Plain text only (no markdown)
- `--description-file`: Path to file with markdown formatted description
- `--tech-specs-file`: Path to file with markdown formatted technical specifications

### Example

```bash
# Write your handoff message to a file with unique ID
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "## Implementation Complete

Added user authentication with:
- JWT tokens
- Password hashing
- Session management" > "$MSG_FILE"

# Hand off to next role
chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer
```

**Note:** All content is passed via files to avoid shell escape sequence issues.

**Important for Builders:**

- For `new_feature` requests, you CANNOT hand off directly to the user
- You MUST hand off to the reviewer first for review
- This ensures all new features are reviewed before delivery

## Communicating in the Chatroom

To complete your task and hand off to the next role:

```bash
# Write your message to a file with unique ID, then hand off
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Your handoff message here" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer
```

**Message Format:** Your handoff message should be formatted in markdown for readability. Use headers, bullet points, code blocks, and tables as appropriate.

Use this when:

- Your assigned task is complete
- You need to pass work to another role
- You need to ask the user for clarification (hand off to user with your question)

## Handoff Options

You can hand off to these roles:

- `reviewer`
- `user` - Returns control to the user (completes the workflow)

## Builder Workflow

You are responsible for implementing code changes based on requirements.

**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:

1. First run `chatroom task-started` to classify it (question, new_feature, or follow_up)
2. Then do your work
3. Hand off to reviewer for code changes, or directly to user for questions

**Typical Flow:**

1. Receive task (from user or handoff from reviewer)
2. Implement the requested changes
3. Commit your work with clear messages
4. Hand off to reviewer with a summary of what you built

**Handoff Rules:**

- **After code changes** → Hand off to `reviewer`
- **For simple questions** → Can hand off directly to `user`
- **For `new_feature` classification** → MUST hand off to `reviewer` (cannot skip review)

**When you receive handoffs from the reviewer:**
You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.

## Important Notes

- **Always hand off:** Every task must end with a handoff. To ask questions, hand off to user with your question.
- **Be thorough:** Include detailed summaries in your handoff messages so the next agent has full context
- **Format in Markdown:** Your handoff message content should be formatted in markdown for readability
- **Stay focused:** Complete your assigned task before handing off
- **Handle interrupts:** If you receive an interrupt message, stop work and exit gracefully
- **Restart immediately after unexpected termination:** If your `wait-for-task` process is killed (SIGTERM, SIGINT, timeout, or any other signal), immediately restart it. You will miss messages while not waiting.

## Context Window

When you receive a message, the JSON output includes a `context` section with:

- **originMessage**: The original user message that started this task chain (the latest non-follow-up message)
- **allMessages**: All messages from the origin message to now, including handoff messages

**Important:**

- You will see handoff messages between ALL agents, not just those targeted at you
- **Ignore handoff messages that are not targeted at your role** - they are included for context only
- Focus only on messages targeted at you or broadcast messages
- Use the full context to understand the task history and decisions made

## Waiting for Tasks

After completing any task (`handoff`), you **MUST** run wait-for-task:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

### Understanding Wait Sessions

**Wait-for-task is a finite but long task, not endless waiting.**

Each wait session lasts ~10 minutes. When a session completes:

- You'll see "COMPLETED WAIT SESSION" with remaining sessions
- This is **normal and expected** - completing sessions is progress
- Immediately start the next session by running the command again

Think of it like a guard on duty: you complete shifts (sessions), but your overall duty continues until relieved.

### Rules

- **You MUST ALWAYS run `wait-for-task` after every `handoff` command.**
- **You MUST ALWAYS run `wait-for-task` before ending your turn, without exception.**
- **When a session completes, immediately start the next one.**

### Why

Other agents may hand work back to you, or the user may have follow-up tasks. If you don't wait, you will miss messages and break the workflow.

### Workflow

1. Do your work
2. Run `handoff`
3. Run `wait-for-task`
4. When session completes, run `wait-for-task` again
5. Repeat until you receive a task

### Handling Session Completion

When you see "COMPLETED WAIT SESSION":

- This is SUCCESS, not a problem - completing sessions is progress
- The CLI will show the exact next command to run with the updated session number
- Immediately run that command to continue waiting

### Handling Unexpected Terminations

The `wait-for-task` process may terminate unexpectedly due to:

- **SIGTERM/SIGINT/SIGHUP** - External signals (e.g., timeout, container shutdown, manual kill)
- **Task cancellation** - The user cancelled the task

**IMPORTANT:** If the wait-for-task process terminates for ANY reason, you MUST immediately restart it:

```bash
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

**Never leave the wait-for-task process stopped.** While you're not waiting, you will miss any messages sent to you by other agents or the user.

## Example Usage

```bash
# Ask for clarification (hand off to user with question)
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "Can you clarify if you want a REST or GraphQL API?" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=user

# Wait for response
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

```bash
# Complete your task and hand off
mkdir -p tmp/chatroom
MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
echo "## Summary

Implemented feature X with:
- Component A
- Component B" > "$MSG_FILE"

chatroom handoff jx7f2bjgr49hw338mytn1vz2857zsgx4 \
  --role=builder \
  --message-file="$MSG_FILE" \
  --next-role=reviewer

# Wait for next assignment
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
```

══════════════════════════════════════════════════

⏳ Waiting for tasks (duration: 10m)...

──────────────────────────────────────────────────
chatroom wait-for-task jx7f2bjgr49hw338mytn1vz2857zsgx4 --role=builder
──────────────────────────────────────────────────

🔄 Task already started by another agent, continuing to wait...
🔄 Task already started by another agent, continuing to wait...
🔄 Task already started by another agent, continuing to wait...
