import { notFound } from 'next/navigation';

import { SketchCanvasHarness } from './SketchCanvasHarness';

export default function SketchCanvasHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SketchCanvasHarness />;
}
