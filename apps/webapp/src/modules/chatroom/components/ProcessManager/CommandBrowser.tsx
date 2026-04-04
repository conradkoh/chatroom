/**
 * CommandBrowser — collapsible sections showing available commands with run buttons and favorites.
 */

'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Play, Star } from 'lucide-react';
import type { RunnableCommand } from './ProcessManager';

interface CommandGroup {
  label: string;
  commands: RunnableCommand[];
}

interface CommandBrowserProps {
  groups: CommandGroup[];
  onRun: (command: RunnableCommand) => void;
  favorites: Set<string>;
  onToggleFavorite: (commandName: string) => void;
  onSelect: (command: RunnableCommand) => void;
}

export function CommandBrowser({ groups, onRun, favorites, onToggleFavorite, onSelect }: CommandBrowserProps) {
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
                  const colonIdx = cmd.name.indexOf(':');
                  const displayName = colonIdx > 0 ? cmd.name.slice(colonIdx + 1).trim() : cmd.name;
                  const isFav = favorites.has(cmd.name);

                  return (
                    <div
                      key={cmd.name}
                      className="w-full flex items-center gap-1 px-4 py-1 text-xs text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors group"
                    >
                      {/* Favorite toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(cmd.name);
                        }}
                        className={`flex-shrink-0 p-0.5 transition-colors ${
                          isFav
                            ? 'text-yellow-500'
                            : 'text-chatroom-text-muted/30 hover:text-yellow-500/50'
                        }`}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star size={10} fill={isFav ? 'currentColor' : 'none'} />
                      </button>

                      {/* Click to select (show detail) */}
                      <button
                        onClick={() => onSelect(cmd)}
                        className="flex-1 min-w-0 text-left truncate"
                        title={cmd.script}
                      >
                        {displayName}
                      </button>

                      {/* Run button (hover) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRun(cmd);
                        }}
                        className="flex-shrink-0 p-0.5 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-opacity hover:text-green-500"
                        title="Run"
                      >
                        <Play size={10} />
                      </button>

                      {cmd.source === 'turbo.json' && (
                        <span className="text-chatroom-text-muted/40 text-[10px] flex-shrink-0">
                          turbo
                        </span>
                      )}
                    </div>
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
