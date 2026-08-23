import { notFound } from 'next/navigation';

import { MermaidHarness } from './MermaidHarness';

export default function MermaidHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <MermaidHarness />;
}
