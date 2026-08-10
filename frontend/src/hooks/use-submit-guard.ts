import { useCallback, useRef } from 'react';

/**
 * Prevents a submit handler from firing again while a previous call is still
 * in flight. `disabled={saving}` alone isn't enough — a fast double/triple
 * tap can fire the handler twice before React commits the re-render that
 * flips `disabled` to true, which is why buttons across the app could be
 * tapped repeatedly and fire duplicate requests. This checks a ref
 * synchronously, before any state update, so repeat taps are dropped
 * immediately regardless of render timing.
 *
 * Usage:
 *   const guard = useSubmitGuard();
 *   const onSave = () => guard(async () => { ...existing body... });
 */
export function useSubmitGuard() {
  const busy = useRef(false);
  return useCallback((fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    fn().finally(() => { busy.current = false; });
  }, []);
}
