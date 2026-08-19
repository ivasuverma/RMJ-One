import { useEffect, useRef, useState } from 'react';

/**
 * Eases a displayed number from its previous value to the next one over
 * `duration` ms, so a stat that changes (e.g. cash closing after a new entry)
 * visibly ticks up/down instead of snapping — which reads as "live". On the
 * very first render it shows the target immediately (no count-up from zero on
 * initial load). Pure JS timers via requestAnimationFrame; no reanimated
 * dependency, works identically on web and native.
 */
export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic — quick to move, gentle to settle.
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setDisplay(target);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return display;
}
