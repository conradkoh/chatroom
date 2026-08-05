'use client';

type KeyboardViewportSliderProps = {
  insetValue: number;
  onInsetChange: (value: number) => void;
  offsetTopValue: number;
  onOffsetTopChange: (value: number) => void;
};

export function KeyboardViewportSlider({
  insetValue,
  onInsetChange,
  offsetTopValue,
  onOffsetTopChange,
}: KeyboardViewportSliderProps) {
  return (
    <section className="space-y-4" data-testid="keyboard-controls">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider" htmlFor="keyboard-inset">
          Keyboard inset: {insetValue}px
        </label>
        <input
          id="keyboard-inset"
          data-testid="keyboard-inset-slider"
          type="range"
          min={0}
          max={360}
          step={20}
          value={insetValue}
          onChange={(e) => onInsetChange(Number(e.target.value))}
          className="w-full"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider" htmlFor="viewport-offset-top">
          Viewport offset top: {offsetTopValue}px
        </label>
        <input
          id="viewport-offset-top"
          data-testid="viewport-offset-top-slider"
          type="range"
          min={0}
          max={240}
          step={20}
          value={offsetTopValue}
          onChange={(e) => onOffsetTopChange(Number(e.target.value))}
          className="w-full"
        />
      </div>
    </section>
  );
}
