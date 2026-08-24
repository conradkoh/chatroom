'use client';
import { isFullSketchSelection, type SketchSelectionRect } from './sketchCanvasSelection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

export function SketchDeleteSelectionDialog({
  open,
  selection,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  selection: SketchSelectionRect | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const scope =
    selection && isFullSketchSelection(selection)
      ? 'the entire 1200 × 900 canvas'
      : selection
        ? `the selected ${Math.round(selection.width)} × ${Math.round(selection.height)} px area`
        : 'the selected area';
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete selected pixels?</AlertDialogTitle>
          <AlertDialogDescription>
            This will clear {scope}. The sketch is not attached until you choose Add sketch.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete pixels</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
