import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from 0 to `end` over `durationMs` milliseconds.
 * Used for the duration display in SegmentRow when a segment becomes ready.
 */
export function useCountUp(end: number, durationMs: number, trigger: boolean): number {
  const [value, setValue] = useState(trigger ? 0 : end);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!trigger) {
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(eased * end);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, durationMs, trigger]);

  return value;
}
