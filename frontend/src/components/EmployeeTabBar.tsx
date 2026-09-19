import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth/AuthContext';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { QuickDocCapture } from '@/src/components/QuickDocCapture';

// Employee tab bar — same layout as the owner/admin bar (OwnerTabBar):
// Home, Work, [camera], Ledger, Settings. Unlike that bar, three of the five
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
export const EMP_LEDGER_MODULES = ['cash_book', 'customer_ledger', 'karigar_ledger'];

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
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [captureDoc, setCaptureDoc] = useState(false);

  const access = employeeTabAccess(hasModule);
  const tabs = [HOME, access.work && WORK, access.ledger && LEDGER, SETTINGS].filter(Boolean) as Tab[];
  const midpoint = Math.ceil(tabs.length / 2);
  const left = tabs.slice(0, midpoint);
  const right = tabs.slice(midpoint);
  const barHeight = 46 + Math.max(insets.bottom, 20);

  // Only the employee group's own screens highlight a tab; a shared module
  // screen (segments start with '(tabs)') leaves them all unselected.
  const focusedKey = segments[0] === '(emp)' ? String(segments[1] ?? '') : '';

  const renderTab = (t: Tab) => {
    const focused = focusedKey === t.key;
    const color = focused ? colors.brandPrimary : colors.mutedText;
    return (
      <Pressable
        key={t.key}
        onPress={() => { if (!focused) router.navigate(t.href as any); }}
        style={styles.tabBtn}
        testID={`emp-tab-${t.key}`}
      >
        <Ionicons name={t.icon} size={22} color={color} />
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{t.title}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { height: barHeight, paddingBottom: Math.max(insets.bottom, 20) }]}>
      {left.map(renderTab)}
      {access.capture && (
        <View style={styles.centerSlot}>
          <Pressable onPress={() => setCaptureDoc(true)} style={styles.centerBtn} testID="emp-tab-capture-btn" hitSlop={8}>
            <Ionicons name="camera" size={28} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      )}
      {right.map(renderTab)}
      <QuickDocCapture visible={captureDoc} onClose={() => setCaptureDoc(false)} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface,
    borderTopWidth: 0, paddingTop: 6,
  },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  tabLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
  centerSlot: { flex: 1, alignItems: 'center' },
  centerBtn: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center', marginTop: -32,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    borderWidth: 3, borderColor: colors.surface,
  },
});
