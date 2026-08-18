import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type TileDef = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; module: string };

// Every tile here maps to one of the employee-assignable modules — an owner
// grants access per module in User Roles, and this screen only shows what's
// actually been handed to this employee. If none are granted the whole
// Transactions tab is hidden by the tab layout, so this screen never renders empty.
// Only four modules are ever grantable to an employee: repairs, repair_bill,
// customer_ledger, karigar_ledger — Tasks/Approvals management is owner/admin
// only now (an employee's personal task list on the Tasks tab is unaffected;
// that's a separate, always-available feature, not this module).
const SECTIONS: { title: string; tiles: TileDef[] }[] = [
  {
    title: 'Repairs',
    tiles: [
      { key: 'repair-orders', label: 'Repair', icon: 'construct-outline', route: '/repairs', module: 'repairs' },
      { key: 'repair-bill', label: 'Repair Bill', icon: 'receipt-outline', route: '/repairs/bill', module: 'repair_bill' },
      { key: 'samples', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples', module: 'samples' },
    ],
  },
  {
    title: 'Reports',
    tiles: [
      { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', module: 'customer_ledger' },
      { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', module: 'karigar_ledger' },
    ],
  },
];

type RepairDashboard = {
  received: number; with_karigar: number; ready: number;
  pending_delivery: number; overdue: number; delivered_today: number;
};

type StatDef = {
  key: keyof RepairDashboard; label: string; icon: keyof typeof Ionicons.glyphMap;
  bg: (c: ThemeColors) => string; fg: (c: ThemeColors) => string; route: string;
};

// Each tile's route lands on the matching screen pre-filtered to that exact
// bucket — repairs/index.tsx and repairs/bill.tsx both read an initial
// `filter` param, so tapping a count here is a shortcut straight into the
// worklist behind it, not just a static number. bg/fg pairs reuse the
// theme's existing tint tokens (same pattern as success/warning/error
// banners elsewhere) rather than inventing new colors.
const STAT_DEFS: StatDef[] = [
  { key: 'received', label: 'Issue Pending', icon: 'cube-outline', bg: (c) => c.brandTertiary, fg: (c) => c.brandPrimary, route: '/repairs?filter=received' },
  { key: 'with_karigar', label: 'With Karigar', icon: 'hammer-outline', bg: (c) => c.info, fg: (c) => c.onInfo, route: '/repairs?filter=with_karigar' },
  { key: 'ready', label: 'Pending to Bill', icon: 'pricetag-outline', bg: (c) => c.warning, fg: (c) => c.onWarning, route: '/repairs/bill?filter=ready' },
  { key: 'pending_delivery', label: 'Pending Delivery', icon: 'time-outline', bg: (c) => c.warning, fg: (c) => c.onWarning, route: '/repairs/bill?filter=pending_delivery' },
  { key: 'overdue', label: 'Overdue', icon: 'alert-circle-outline', bg: (c) => c.error, fg: (c) => c.onError, route: '/repairs?filter=overdue' },
  { key: 'delivered_today', label: 'Delivered Today', icon: 'checkmark-done-outline', bg: (c) => c.success, fg: (c) => c.onSuccess, route: '/repairs/bill?filter=delivered' },
];

export default function EmployeeTransactionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [dash, setDash] = useState<RepairDashboard | null>(null);
  // Either right is enough to see this — a bill-only biller still cares
  // about what's pending to bill/deliver, not just full repair access.
  const showRepairDash = hasModule('repairs') || hasModule('repair_bill');

  const loadDash = useCallback(async () => {
    if (!showRepairDash) { setDash(null); return; }
    try { setDash(await api.get<RepairDashboard>('/repairs/dashboard')); }
    catch (_e) { setDash(null); }
  }, [showRepairDash]);

  useFocusEffect(useCallback(() => { loadDash(); }, [loadDash]));

  const sections = SECTIONS
    .map((s) => ({ ...s, tiles: s.tiles.filter((t) => hasModule(t.module)) }))
    .filter((s) => s.tiles.length > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-transactions-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>Where you record something happening.</Text>

        {showRepairDash && dash && (
          <View testID="emp-repair-dashboard">
            <Text style={styles.sectionLabel}>Repair Dashboard</Text>
            <View style={styles.statGrid}>
              {STAT_DEFS.map((s) => (
                <Pressable
                  key={s.key}
                  testID={`repair-dash-stat-${s.key}`}
                  onPress={() => router.push(s.route as any)}
                  style={({ pressed }) => [styles.statTile, pressed && { opacity: 0.8 }]}
                >
                  <View style={[styles.statIcon, { backgroundColor: s.bg(colors), borderColor: s.fg(colors) }]}>
                    <Ionicons name={s.icon} size={18} color={s.fg(colors)} />
                  </View>
                  <Text style={styles.statValue}>{dash[s.key]}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {sections.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Nothing assigned to you yet.</Text></View>
        ) : sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`emp-transactions-tile-${t.key}`}
                  onPress={() => router.push(t.route as any)}
                  style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
                >
                  <View style={styles.tileIcon}>
                    <Ionicons name={t.icon} size={24} color={colors.brandPrimary} />
                  </View>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: 4 },
  subtitle: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.xl },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  sectionLabel: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: spacing.md, marginTop: spacing.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '31%', flexGrow: 0, maxWidth: '31%', minWidth: 96,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.brand,
  },
  tileLabel: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statTile: {
    flexBasis: '31%', flexGrow: 0, maxWidth: '31%', minWidth: 96,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  statIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs, borderWidth: 1,
  },
  statValue: { color: colors.onSurface, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 2 },
});
