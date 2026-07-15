'use client';

type KeyboardInsetSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

export function KeyboardInsetSlider({ value, onChange }: KeyboardInsetSliderProps) {
  return (
    <section className="space-y-2" data-testid="keyboard-controls">
      <label className="text-xs font-bold uppercase tracking-wider" htmlFor="keyboard-inset">
        Simulated keyboard inset: {value}px
      </label>
      <input
        id="keyboard-inset"
        data-testid="keyboard-inset-slider"
        type="range"
        min={0}
        max={360}
        step={20}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </section>
  );
}
