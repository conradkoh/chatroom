<!--
Current Time: Jan 22, 2026 at 2:35 PM
## Role
{role guidance)

## Command reference
{commands} <- make backlog command available to all.

## 📍 Pinned
### Primary User Directive
<user-message>
{user message content}
</user-message>

### Inferred Task (inferred from user directive)
Not created yet. Run `chatroom task-started …` to specify task.

-->

# Task Content

## New Message (addressed to you for processing)

<message>
From: user
To: builder

{message content}
</message>

Please infer the task from the message addressed to you and acknowledge it using the command:

> chatroom task-started <chatroomId> --task-id=<taskId> --role=builder --origin-message-classification=<question|new_feature|follow_up>
