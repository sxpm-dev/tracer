import type { ReactNode } from 'react';

export function DashboardShell({
  children,
  sidebar,
  theme,
  toolbar,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  theme: string;
  toolbar: ReactNode;
}) {
  return (
    <div className="cd-page cd-workspace" data-theme={theme}>
      <div className="cd-window">
        {sidebar}
        <main className="cd-main">
          {toolbar}
          <div className="cd-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
