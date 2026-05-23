/**
 * EmptyOutputState — placeholder shown in the detail pane when no command is selected.
 */

export function EmptyOutputState() {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      Select a command to view output
    </div>
  );
}
