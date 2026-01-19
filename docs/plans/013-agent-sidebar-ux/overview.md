# Plan 013: Agent Sidebar UX Improvements

## Summary

Improve the AGENTS section in the chatroom sidebar to be more compact and focused on active work.

## Problem

The current AgentPanel shows all agents as separate expandable rows:
- Takes up too much fixed height
- Active agents aren't visually prioritized
- Ready (waiting) agents clutter the view

## Solution

Redesign the agent section to:
1. **Prominently show working agents** - Active agents get full visibility
2. **Collapse ready agents** - Group all ready agents into a single collapsible item
3. **Reduce overall height** - More compact design

## Goals

1. Prioritize visibility for active/working agents
2. Reduce visual clutter from idle agents
3. Maintain quick access to agent prompts
4. Keep the UI simple and scannable

## Non-Goals

- Real-time agent activity streaming
- Agent chat history in sidebar
- Agent metrics/performance tracking
