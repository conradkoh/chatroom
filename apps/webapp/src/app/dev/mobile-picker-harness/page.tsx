import { notFound } from 'next/navigation';

import { MobilePickerHarness } from './MobilePickerHarness';

export default function MobilePickerHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <MobilePickerHarness />;
}
