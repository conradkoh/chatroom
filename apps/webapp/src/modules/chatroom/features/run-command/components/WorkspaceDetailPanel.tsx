/**
 * WorkspaceDetailPanel — shows all commands in a workspace with run and favorite actions.
 * Part of the run-command vertical slice.
 */

'use client';

import { ChevronLeft } from 'lucide-react';
import type { RunnableCommand } from '../types/run';
import { extractScriptName, type WorkspaceGroup } from '../utils/grouping';

interface WorkspaceDetailPanelProps {
  workspace: WorkspaceGroup;
  favorites: Set<string>;
  onRun: (cmd: RunnableCommand) => void;
  onToggleFavorite: (name: string) => void;
  onSelectCommand: (cmd: RunnableCommand) => void;
  onClose: () => void;
}

export function WorkspaceDetailPanel({
  workspace,
  favorites,
  onRun,
  onToggleFavorite,
  onSelectCommand,
  onClose,
}: WorkspaceDetailPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-1.5 py-1.5 sm:px-4 sm:py-2 border-b border-chatroom-border">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors flex-shrink-0"
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              {workspace.path === '.' ? 'Root' : workspace.path}
            </h3>
            <p className="text-[10px] text-chatroom-text-muted mt-0.5">
              {workspace.allCommands.length} commands available
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(() => {
          const favSet = new Set(favorites);
          const favourited: RunnableCommand[] = [];
          const common: RunnableCommand[] = [];
          const others: RunnableCommand[] = [];

          for (const cmd of workspace.allCommands) {
            const isCommon =
              cmd.source === 'package.json' && (cmd.subWorkspace?.path ?? '.') === '.';
            if (favSet.has(cmd.name)) {
              favourited.push(cmd);
            } else if (isCommon) {
              common.push(cmd);
            } else {
              others.push(cmd);
            }
          }

          const renderCommand = (cmd: RunnableCommand) => {
            const scriptName = extractScriptName(cmd.name);
            const isFav = favSet.has(cmd.name);
            return (
              <div
                key={cmd.name}
                className="flex items-center gap-2 px-1.5 py-1.5 sm:px-4 hover:bg-chatroom-bg-hover transition-colors group"
              >
                <button
                  onClick={() => onToggleFavorite(cmd.name)}
                  className={`flex-shrink-0 transition-colors ${
                    isFav
                      ? 'text-yellow-500'
                      : 'text-chatroom-text-muted/30 hover:text-yellow-500/50'
                  }`}
                >
                  ★
                </button>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectCommand(cmd)}>
                  <div className="text-xs text-chatroom-text-primary font-bold uppercase tracking-wider">
                    {scriptName}
                  </div>
                  <div className="text-[10px] text-chatroom-text-muted truncate font-mono">
                    {cmd.script}
                  </div>
                </div>
                <button
                  onClick={() => onRun(cmd)}
                  className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  Run
                </button>
              </div>
            );
          };

          return (
            <>
              {favourited.length > 0 && (
                <>
                  <div className="px-1.5 py-1.5 sm:px-4 text-[10px] font-bold uppercase tracking-wider text-yellow-500/70 border-b border-chatroom-border/30">
                    ★ Favourites
                  </div>
                  {favourited.map(renderCommand)}
                </>
              )}
              {common.length > 0 && (
                <>
                  <div className="px-1.5 py-1.5 sm:px-4 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted/50 border-b border-chatroom-border/30 mt-1">
                    Common Commands
                  </div>
                  {common.map(renderCommand)}
                </>
              )}
              {others.length > 0 && (
                <>
                  <div className="px-1.5 py-1.5 sm:px-4 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted/50 border-b border-chatroom-border/30 mt-1">
                    Commands
                  </div>
                  {others.map(renderCommand)}
                </>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
