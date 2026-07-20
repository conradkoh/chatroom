import { notFound } from 'next/navigation';

import { SiReleaseHarness } from './SiReleaseHarness';

export default function SiReleaseHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <SiReleaseHarness />;
}
