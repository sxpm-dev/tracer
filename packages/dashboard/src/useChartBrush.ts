import { type PointerEvent, useRef, useState } from 'react';

export function useChartBrush(
  duration: number,
  onRange?: (range: [number, number]) => void,
) {
  const [preview, setPreview] = useState<[number, number]>();
  const start = useRef<number>();
  const moved = useRef(false);
  const time = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        duration,
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * duration,
      ),
    );
  };
  return {
    handlers: {
      onClickCapture: (event: React.MouseEvent) => {
        if (moved.current) {
          event.stopPropagation();
          moved.current = false;
        }
      },
      onPointerCancel: () => {
        start.current = undefined;
        setPreview(undefined);
      },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !onRange) {
          return;
        }
        start.current = time(event);
        moved.current = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (start.current === undefined) {
          return;
        }
        const end = time(event);
        moved.current = Math.abs(end - start.current) > duration / 1000;
        setPreview([
          Math.min(start.current, end),
          Math.max(start.current, end),
        ]);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (start.current === undefined) {
          return;
        }
        const end = time(event);
        if (moved.current) {
          onRange?.([
            Math.min(start.current, end),
            Math.max(start.current, end),
          ]);
        }
        start.current = undefined;
        setPreview(undefined);
      },
    },
    preview,
  };
}
