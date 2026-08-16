'use client';
import { cn } from '@/lib/utils';
import { SKETCH_BRUSH_PALETTE } from './sketchConstants';
export function SketchColorPicker({ value, onChange, disabled }: { value: string; onChange: (color: string) => void; disabled?: boolean }) { return <fieldset aria-label="Brush color" className="flex items-center gap-2 border-0 p-0 m-0">{SKETCH_BRUSH_PALETTE.map((color) => <button key={color} type="button" aria-label={`Brush color ${color}`} aria-pressed={value === color} disabled={disabled} onClick={() => onChange(color)} className={cn('h-6 w-6 rounded-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40', value === color && 'ring-2 ring-chatroom-accent ring-offset-1')} style={{ backgroundColor: color }} />)}</fieldset>; }
