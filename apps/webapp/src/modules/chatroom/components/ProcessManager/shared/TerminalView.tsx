import { forwardRef } from 'react';
import type { CommandRun } from '../ProcessManager';
import { isActiveRun } from './run-status';

interface TerminalViewProps {
  output: string;
  status: CommandRun['status'] | null;
  scriptHint?: string;
}

/**
 * TerminalView — shared <pre> terminal output area with auto-scroll ref support,
 * "Waiting for process..." empty state, and a blinking cursor while active.
 */
export const TerminalView = forwardRef<HTMLPreElement, TerminalViewProps>(
  function TerminalView({ output, status, scriptHint }, ref) {
    const showCursor = isActiveRun(status);
    const emptyHint = status === 'pending' ? 'Waiting for process to start...\n' : '';
    return (
      <pre
        ref={ref}
        className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-green-400 dark:text-green-300 bg-black/90 whitespace-pre-wrap break-words"
      >
        {scriptHint && (
          <>
            <span className="text-chatroom-text-muted">$ {scriptHint}</span>
            {'\n'}
          </>
        )}
        {output || emptyHint}
        {showCursor && <span className="text-chatroom-text-muted animate-pulse">▌</span>}
      </pre>
    );
  }
);
