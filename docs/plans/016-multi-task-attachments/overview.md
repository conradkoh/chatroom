# 016 - Multi-Task Attachments

## Summary

Allow users to attach multiple backlog tasks as context when sending a message, with a chip-based UI above the message input.

## Problem

Currently, when a user clicks "Move to Chat" on a backlog task:
1. A modal opens prompting for a message
2. Only ONE task can be attached per message
3. Users cannot batch multiple related tasks together

## Solution

Replace the modal flow with a chip-based attachment system:
1. "Add to Chat" adds the task to an attachment queue (displayed as chips)
2. Multiple tasks can be accumulated before sending
3. The message is sent with all attached tasks
4. All attached tasks are marked as "started" in their backlog lifecycle

## Requirements Confirmed

| Question | Answer |
|----------|--------|
| Should "Add to Chat" close the TaskDetailModal? | Yes |
| Keep MoveToChatModal for quick single-task send? | No, remove it |
| Maximum attached tasks limit? | 10 (extensible for images in future) |

## Status

Planning complete, ready for implementation.
