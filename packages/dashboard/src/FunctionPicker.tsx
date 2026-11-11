import { useEffect, useId, useRef, useState } from 'react';

import type { CoreFunctionStat } from './coreAnalysis';

import { NamespaceBadge } from './NamespaceBadge';
import { namespaceMatches } from './namespaceSelection';
import { TraceKindIcon } from './TraceKindIcon';

export function FunctionPicker({
  functions,
  namespace,
  onChange,
  onSelect,
  value,
}: {
  functions: CoreFunctionStat[];
  namespace?: string;
  onChange: (value: string) => void;
  onSelect?: (item: CoreFunctionStat) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = functions
    .filter(
      (item) =>
        namespaceMatches(namespace, item.namespace) &&
        `${item.namespace}.${item.name}`
          .toLowerCase()
          .includes(value.toLowerCase()),
    )
    .slice(0, 100);
  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);
  const choose = (item: CoreFunctionStat) => {
    if (onSelect) {
      onSelect(item);
    } else {
      onChange(`${item.namespace}.${item.name}`);
    }
    setOpen(false);
  };
  return (
    <div className="cd-function-picker" ref={root}>
      <label htmlFor={`${id}-input`}>Function</label>
      <div className="cd-function-picker-input">
        <input
          aria-activedescendant={
            open && options[active] ? `${id}-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={id}
          aria-expanded={open}
          aria-label="Filter functions"
          autoComplete="off"
          id={`${id}-input`}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              event.stopPropagation();
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive(Math.min(active + 1, options.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(0, active - 1));
            }
            if (event.key === 'Enter' && open && options[active]) {
              event.preventDefault();
              choose(options[active]);
            }
            if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
          placeholder="Filter by function name"
          role="combobox"
          value={value}
        />
        {value && (
          <button
            aria-label="Clear function filter"
            className="cd-function-picker-clear"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            type="button"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div
          aria-label="Available functions"
          className="cd-function-options"
          id={id}
          role="listbox"
        >
          {options.map((item, index) => (
            <div
              aria-selected={value === `${item.namespace}.${item.name}`}
              className={index === active ? 'is-active' : ''}
              id={`${id}-${index}`}
              key={`${item.namespace}.${item.name}`}
              onClick={() => choose(item)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
            >
              <NamespaceBadge name={item.namespace} />
              <TraceKindIcon kind="call" />
              <span className="cd-function-option-name" title={item.name}>
                {item.name}
              </span>
              <span className="cd-function-option-count">
                <span className="cd-data-number">
                  {item.calls.toLocaleString()}
                </span>{' '}
                records
              </span>
            </div>
          ))}
          {!options.length && <p>No matching functions</p>}
        </div>
      )}
    </div>
  );
}
