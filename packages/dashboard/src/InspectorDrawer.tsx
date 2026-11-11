import { type ReactNode, type ReactPortal, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { DashboardIcon } from './DashboardIcon';
import { NamespaceBadge } from './NamespaceBadge';
import { useDashboardTheme } from './theme';

export function InspectorDrawer({
  children,
  companion,
  onClose,
  subtitle,
  title,
}: {
  children: ReactNode;
  companion?: ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
}): ReactPortal | null {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const { theme } = useDashboardTheme();
  const separator = title.lastIndexOf('.');
  const owner =
    separator > 0 && separator < title.length - 1
      ? title.slice(0, separator)
      : undefined;
  const method = owner ? title.slice(separator + 1) : title;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    if (typeof node.showModal === 'function') {
      node.showModal();
    } else {
      node.setAttribute('open', '');
    }
    close.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      aria-label={title}
      className={`cd-page cd-drawer ${companion ? 'cd-drawer-with-chart' : ''}`}
      data-theme={theme}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialog}
    >
      {companion && <div className="cd-drawer-companion">{companion}</div>}
      <div className="cd-drawer-surface">
        <header>
          <div>
            <span className="cd-eyebrow">INSPECTOR</span>
            <h2 title={title}>
              {owner && (
                <span className="cd-drawer-owner">
                  {owner.replace(/\s+/g, '')}.
                </span>
              )}
              <span className="cd-drawer-method">
                {method.split(/(?<=[a-z0-9])(?=[A-Z])/).map((part, index) => (
                  <span key={index}>
                    {index > 0 && <wbr />}
                    {part}
                  </span>
                ))}
              </span>
            </h2>
            {subtitle && (
              <p>
                <NamespaceBadge name={subtitle} />
              </p>
            )}
          </div>
          <button
            aria-label="Close inspector"
            className="cd-icon-button"
            onClick={onClose}
            ref={close}
          >
            <DashboardIcon name="close" />
          </button>
        </header>
        <div className="cd-drawer-content">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
