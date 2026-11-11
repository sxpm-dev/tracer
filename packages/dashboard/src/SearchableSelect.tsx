import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { DashboardIcon } from './DashboardIcon';
import { NamespaceBadge } from './NamespaceBadge';
import { selectedNamespaces, toggleNamespace } from './namespaceSelection';

export interface SelectOption {
  color?: string;
  detail?: string;
  label: string;
  value: string;
}
export function SearchableSelect({
  label,
  multiple = false,
  onChange,
  options,
  value,
}: {
  label: string;
  multiple?: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) =>
    isSelected(option.value, value, multiple),
  );
  const choose = (next: string) => {
    if (multiple) {
      onChange(toggleNamespace(value, next));
      return;
    }
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="cd-searchable-select">
      <span>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${multiple ? selectedNamespaces(value).join(', ') || 'All namespaces' : (selected?.label ?? value)}`}
        className="cd-select-trigger"
        onClick={() => setOpen(!open)}
        ref={trigger}
        type="button"
      >
        <span>
          <SelectValue multiple={multiple} selected={selected} value={value} />
        </span>
        <DashboardIcon name="caret-down" />
      </button>
      {open && trigger.current && (
        <SelectPopup
          label={label}
          multiple={multiple}
          onClose={() => setOpen(false)}
          onSelect={choose}
          options={options}
          trigger={trigger.current}
          value={value}
        />
      )}
    </div>
  );
}
function SelectPopup({
  label,
  multiple,
  onClose,
  onSelect,
  options,
  trigger,
  value,
}: {
  label: string;
  multiple: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  options: SelectOption[];
  trigger: HTMLButtonElement;
  value: string;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(query.toLowerCase()),
  );
  const visible = matches.slice(0, 100);
  useEffect(() => {
    search.current?.focus();
    const dismiss = (event: Event) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        !trigger.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const reposition = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      window.removeEventListener('resize', reposition);
    };
  }, [onClose, trigger]);
  useEffect(() => {
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);
  const rect = trigger.getBoundingClientRect();
  const height = Math.min(370, window.innerHeight - 32);
  const above = rect.bottom + height + 8 > window.innerHeight;
  const top = above ? Math.max(8, rect.top - 8) : rect.bottom + 8;
  return createPortal(
    <div
      aria-label={`${label} options`}
      className="cd-page cd-select-popup"
      data-theme={trigger.closest('[data-theme]')?.getAttribute('data-theme')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          trigger.focus();
        }
      }}
      ref={popup}
      role="dialog"
      style={{
        left: Math.max(
          8,
          Math.min(
            rect.left,
            window.innerWidth -
              Math.min(Math.max(rect.width, 280), 420, window.innerWidth - 16) -
              8,
          ),
        ),
        maxHeight: above
          ? Math.min(height, Math.max(80, rect.top - 16))
          : height,
        top,
        transform: above ? 'translateY(-100%)' : undefined,
        width: Math.min(Math.max(rect.width, 280), 420, window.innerWidth - 16),
      }}
    >
      <input
        aria-activedescendant={visible[active] ? `${id}-${active}` : undefined}
        aria-controls={id}
        aria-expanded="true"
        aria-label={`Search ${label.toLowerCase()}`}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(Math.min(active + 1, visible.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(Math.max(0, active - 1));
          }
          if (event.key === 'Enter' && visible[active]) {
            event.preventDefault();
            onSelect(visible[active].value);
          }
        }}
        placeholder={`Filter ${label.toLowerCase()}…`}
        ref={search}
        role="combobox"
        value={query}
      />
      <div
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="cd-select-options"
        id={id}
        role="listbox"
      >
        {visible.map((option, index) => (
          <div
            aria-selected={isSelected(option.value, value, multiple)}
            className={index === active ? 'is-active' : ''}
            id={`${id}-${index}`}
            key={option.value}
            onClick={() => onSelect(option.value)}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
          >
            <span>
              {option.color ? (
                <NamespaceBadge name={option.label} />
              ) : (
                option.label
              )}
            </span>
            {option.detail && <small>{option.detail}</small>}
            {isSelected(option.value, value, multiple) && (
              <DashboardIcon name="check" />
            )}
          </div>
        ))}
      </div>
      {!matches.length && <p role="status">No matching options</p>}
      {matches.length > 100 && (
        <small className="cd-select-count">
          Showing 100 of {matches.length.toLocaleString()} — type to narrow the
          list
        </small>
      )}
    </div>,
    document.body,
  );
}

function isSelected(option: string, value: string, multiple: boolean) {
  return multiple
    ? option
      ? selectedNamespaces(value).includes(option)
      : !value
    : option === value;
}
function SelectValue({
  multiple,
  selected,
  value,
}: {
  multiple: boolean;
  selected?: SelectOption;
  value: string;
}) {
  if (multiple) {
    const values = selectedNamespaces(value);
    return values.length ? (
      <>
        {values.map((name) => (
          <NamespaceBadge key={name} name={name} />
        ))}
      </>
    ) : (
      <>All namespaces</>
    );
  }
  return selected?.color ? (
    <NamespaceBadge name={selected.label} />
  ) : (
    <>{selected?.label ?? value}</>
  );
}
