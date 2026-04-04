/**
 * CommandBrowser — collapsible sections showing available commands with run buttons.
 */

'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import type { RunnableCommand } from './ProcessManager';

interface CommandGroup {
  label: string;
  commands: RunnableCommand[];
}

interface CommandBrowserProps {
  groups: CommandGroup[];
  onRun: (command: RunnableCommand) => void;
}

export function CommandBrowser({ groups, onRun }: CommandBrowserProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <div className="p-4 text-xs text-chatroom-text-muted text-center">
        No commands found
      </div>
    );
  }

  return (
    <div>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.label);
        return (
          <div key={group.label}>
            {/* Group header */}
            <button
              onClick={() => toggleCollapse(group.label)}
              className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:bg-chatroom-bg-hover transition-colors"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span>{group.label}</span>
              <span className="ml-auto text-chatroom-text-muted/50">{group.commands.length}</span>
            </button>

            {/* Commands */}
            {!isCollapsed && (
              <div>
                {group.commands.map((cmd) => {
                  // Extract the part after ":" for display
                  const colonIdx = cmd.name.indexOf(':');
                  const displayName = colonIdx > 0 ? cmd.name.slice(colonIdx + 1).trim() : cmd.name;

                  return (
                    <button
                      key={cmd.name}
                      onClick={() => onRun(cmd)}
                      className="w-full flex items-center gap-2 px-4 py-1 text-xs text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors group"
                      title={cmd.script}
                    >
                      <Play
                        size={10}
                        className="text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      />
                      <span className="truncate">{displayName}</span>
                      <span className="ml-auto text-chatroom-text-muted/40 text-[10px] truncate max-w-[100px]">
                        {cmd.source === 'turbo.json' ? 'turbo' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
