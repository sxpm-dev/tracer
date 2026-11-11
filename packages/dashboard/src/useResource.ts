import { useEffect, useState } from 'react';

/** One current result. Navigation aborts and releases the previous request. */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const [state, setState] = useState<{ data?: T; error?: string; key: string }>(
    { key: '' },
  );
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    setState({ key });
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setState({ data, key });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ error: String(error), key });
        }
      },
    );
    return () => controller.abort();
    // The key fully identifies the request; callers need not memoize load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return enabled && state.key === key ? state : { key };
}
