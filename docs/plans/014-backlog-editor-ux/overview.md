# Plan 014: Backlog Editor UX Improvements (Desktop)

## Summary

Improve the backlog item editing experience on desktop by providing a larger, full-featured modal with side-by-side markdown preview.

## Problem

Current issues with the TaskDetailModal on desktop:

1. **Width too narrow** - Modal is `max-w-lg` (512px), constraining content
2. **Height constrained** - `max-h-[85vh]` limits vertical space for long content
3. **No preview while editing** - Can't see rendered markdown while typing
4. **Poor for long content** - Backlog items can be full markdown requirements docs

Mobile behavior is acceptable - the issue is desktop-specific.

## Solution

Create a desktop-optimized backlog editor modal:

1. **Wider modal** - Full-width with comfortable margins
2. **Taller modal** - Near full-height for long content
3. **Side-by-side editing** - Editor on left, live preview on right
4. **Responsive** - Falls back to current behavior on mobile

## Goals

1. Comfortable editing for long markdown content
2. Live preview while editing
3. Keep mobile experience unchanged
4. Maintain existing functionality (edit, delete, move to queue)

## Non-Goals

- Syntax highlighting in editor
- Rich text (WYSIWYG) editing
- File attachments or images
- Collaborative editing
