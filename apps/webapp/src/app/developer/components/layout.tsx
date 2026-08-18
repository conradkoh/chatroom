import { redirect } from 'next/navigation';

export default function DeveloperComponentsLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') redirect('/');
  return <>{children}</>;
}
