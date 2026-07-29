'use client';

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="app-page-content flex flex-col flex-1 min-h-0 h-full w-full"
      style={{ viewTransitionName: 'app-page-content' }}
    >
      {children}
    </div>
  );
}
