import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Apple §14: reduced motion doesn't mean *no* feedback — it means a gentler,
// non-vestibular equivalent. Components read this and swap springs/slides for
// short cross-fades (or no transform). On web this maps to the
// `prefers-reduced-motion` media query; on native to the OS accessibility flag.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduced(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { mounted = false; sub.remove(); };
  }, []);
  return reduced;
}
