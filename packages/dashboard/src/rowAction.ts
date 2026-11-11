import type { KeyboardEvent, MouseEvent } from 'react';

/** Keep explicit controls independent from the row's primary action. */
export function rowAction(action: () => void) {
  return {
    onClick: (event: MouseEvent<HTMLTableRowElement>) => {
      if (
        !(event.target as Element).closest(
          'button, a, input, select, textarea, summary',
        )
      ) {
        action();
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (
        event.target === event.currentTarget &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault();
        action();
      }
    },
    tabIndex: 0,
  };
}
