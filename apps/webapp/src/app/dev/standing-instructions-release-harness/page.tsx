import { notFound } from 'next/navigation';

import { StandingInstructionsReleaseHarness } from './StandingInstructionsReleaseHarness';

export default function StandingInstructionsReleaseHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <StandingInstructionsReleaseHarness />;
}
