import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { QuickDocCapture } from '@/src/components/QuickDocCapture';
import { GlassTabBar } from '@/src/components/GlassTabBar';

// Employee tab bar — same frosted-glass bar as the owner/admin one
// (GlassTabBar): Home, Work, Ledger, Settings + camera. Unlike that bar, three of the five
// slots are conditional, because an employee only sees what the owner has
// switched on for them (Settings > Users):
//   Work    — any of Repairs, Stock In/Out, Cash Book, Documents
//   Ledger  — any of Cash Book, Customer Ledger, Karigar Ledger
//   Camera  — Documents
// Home and Settings are always there.
//
// This is deliberately NOT built on the Tabs navigator's own state the way
// OwnerTabBar is. The same bar has to render on the employee shell ((emp))
// AND on the shared module screens that live in the (tabs) group (Cash Book,
// Repairs, Stock In/Out, Documents), where the navigator's routes are the
// owner's — navigating by tab name there would land an employee on an
// owner-only screen. So it navigates by explicit href and works out which tab
// is focused from the URL segments.
export const EMP_WORK_MODULES = ['repairs', 'samples', 'cash_book', 'documents'];
// (Cash Book is on the Work tab, not here.)
export const EMP_LEDGER_MODULES = ['customer_ledger', 'karigar_ledger'];

export function employeeTabAccess(hasModule: (key: string) => boolean) {
  return {
    work: EMP_WORK_MODULES.some(hasModule),
    ledger: EMP_LEDGER_MODULES.some(hasModule),
    capture: hasModule('documents'),
  };
}

type Tab = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; href: string };

const HOME: Tab = { key: 'home', title: 'Home', icon: 'scan-outline', href: '/(emp)/home' };
const WORK: Tab = { key: 'work', title: 'Work', icon: 'briefcase-outline', href: '/(emp)/work' };
const LEDGER: Tab = { key: 'ledger', title: 'Ledger', icon: 'book-outline', href: '/(emp)/ledger' };
const SETTINGS: Tab = { key: 'profile', title: 'Settings', icon: 'settings-outline', href: '/(emp)/profile' };

export function EmployeeTabBar() {
  const { hasModule } = useAuth();
  const router = useRouter();
  // useSegments()'s compile-time type is only as wide as the app's generated
  // route literals (a 1-tuple here, since this project doesn't check in
  // .expo/types/router.d.ts) — at runtime it's always the full path segment
  // array, so this reflects that rather than the narrower inferred type.
  const segments = useSegments() as unknown as string[];
  const [captureDoc, setCaptureDoc] = useState(false);

  const access = employeeTabAccess(hasModule);
  const tabs = [HOME, access.work && WORK, access.ledger && LEDGER, SETTINGS].filter(Boolean) as Tab[];

  // Only the employee group's own screens highlight a tab; a shared module
  // screen (segments start with '(tabs)') leaves them all unselected.
  const focusedKey = segments[0] === '(emp)' ? String(segments[1] ?? '') : '';

  return (
    <>
      <GlassTabBar
        tabs={tabs.map((t) => ({
          key: t.key, label: t.title, icon: t.icon, focused: focusedKey === t.key, testID: `emp-tab-${t.key}`,
          onPress: () => { if (focusedKey !== t.key) router.navigate(t.href as any); },
        }))}
        onCapture={access.capture ? () => setCaptureDoc(true) : undefined}
        captureTestID="emp-tab-capture-btn"
      />
      <QuickDocCapture visible={captureDoc} onClose={() => setCaptureDoc(false)} />
    </>
  );
}
