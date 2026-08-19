import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Employee Work hub (v2 3-tab IA). Replaces the old conditional "Transactions"
// tab and folds the personal Tasks tab in as a tile. Always visible — even an
// employee with no granted operations modules still has My Tasks and My
// Ledger here, so the tab is never a dead end. The repair/sample at-a-glance
// dashboards and the granted-module tiles are the same as before; only the
// navigation shell around them changed.
type TileDef = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; module?: string };

const OPERATIONS_TILES: TileDef[] = [
  { key: 'repair-orders', label: 'Repair', icon: 'construct-outline', route: '/repairs', module: 'repairs' },
  { key: 'repair-bill', label: 'Repair Bill', icon: 'receipt-outline', route: '/repairs/bill', module: 'repair_bill' },
  { key: 'samples', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples', module: 'samples' },
  { key: 'cash-book', label: 'Cash Book', icon: 'wallet-outline', route: '/cashbook', module: 'cash_book' },
  { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', module: 'customer_ledger' },
  { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', module: 'karigar_ledger' },
];

type RepairDashboard = {
  received: number; with_karigar: number; ready: number;
  pending_delivery: number; overdue: number; delivered_today: number;
};
type SamplesDashboard = { with_karigar: number; overdue: number; received_today: number };

type Tone = 'alert' | 'warn' | 'info' | 'neutral';
const toneColors = (t: Tone, c: ThemeColors): { bg: string; fg: string } => {
  if (t === 'alert') return { bg: c.error, fg: c.onError };
  if (t === 'warn') return { bg: c.warning, fg: c.onWarning };
  if (t === 'info') return { bg: c.info, fg: c.onInfo };
  return { bg: c.brandTertiary, fg: c.brandPrimary };
};

type StatRow = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tone: Tone; route: string; count: number };

function buildRepairRows(d: RepairDashboard): StatRow[] {
  return [
    { key: 'overdue', label: 'Overdue', icon: 'alert-circle-outline', tone: 'alert', route: '/repairs?filter=overdue', count: d.overdue },
    { key: 'received', label: 'Issue Pending', icon: 'cube-outline', tone: 'neutral', route: '/repairs?filter=received', count: d.received },
    { key: 'ready', label: 'Pending to Bill', icon: 'pricetag-outline', tone: 'warn', route: '/repairs/bill?filter=ready', count: d.ready },
    { key: 'pending_delivery', label: 'Pending Delivery', icon: 'time-outline', tone: 'warn', route: '/repairs/bill?filter=pending_delivery', count: d.pending_delivery },
    { key: 'with_karigar', label: 'With Karigar', icon: 'hammer-outline', tone: 'info', route: '/repairs?filter=with_karigar', count: d.with_karigar },
  ];
}
function buildSampleRows(d: SamplesDashboard): StatRow[] {
  return [
    { key: 'overdue', label: 'Overdue', icon: 'alert-circle-outline', tone: 'alert', route: '/samples?status=overdue', count: d.overdue },
    { key: 'with_karigar', label: 'With Karigar', icon: 'hammer-outline', tone: 'info', route: '/samples?status=with_karigar', count: d.with_karigar },
  ];
}

function DashCard({ testID, title, caption, rows, colors, onPress }: {
  testID: string; title: string; caption?: string; rows: StatRow[]; colors: ThemeColors; onPress: (route: string) => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View testID={testID}>
      <View style={styles.dashHeaderRow}>
        <Text style={styles.sectionLabel}>{title}</Text>
        {!!caption && <Text style={styles.dashCaption}>{caption}</Text>}
      </View>
      <View style={styles.dashCard}>
        {rows.map((r, i) => {
          const tone: Tone = r.count === 0 ? 'neutral' : r.tone;
          const { bg, fg } = toneColors(tone, colors);
          return (
            <Pressable
              key={r.key}
              testID={`dash-row-${testID}-${r.key}`}
              onPress={() => onPress(r.route)}
              style={({ pressed }) => [styles.dashRow, i === rows.length - 1 && styles.dashRowLast, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.dashIcon, { backgroundColor: bg }]}>
                <Ionicons name={r.icon} size={14} color={fg} />
              </View>
              <Text style={styles.dashLabel}>{r.label}</Text>
              <Text style={[styles.dashCount, r.count > 0 && r.tone === 'alert' && { color: colors.onError }]}>{r.count}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.mutedText} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function EmployeeWorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [repairDash, setRepairDash] = useState<RepairDashboard | null>(null);
  const [sampleDash, setSampleDash] = useState<SamplesDashboard | null>(null);
  const showRepairDash = hasModule('repairs') || hasModule('repair_bill');
  const showSampleDash = hasModule('samples');

  const loadDash = useCallback(async () => {
    if (showRepairDash) {
      try { setRepairDash(await api.get<RepairDashboard>('/repairs/dashboard')); }
      catch (_e) { setRepairDash(null); }
    } else setRepairDash(null);
    if (showSampleDash) {
      try { setSampleDash(await api.get<SamplesDashboard>('/samples/dashboard')); }
      catch (_e) { setSampleDash(null); }
    } else setSampleDash(null);
  }, [showRepairDash, showSampleDash]);

  useFocusEffect(useCallback(() => { loadDash(); }, [loadDash]));

  const opsTiles = OPERATIONS_TILES.filter((t) => !t.module || hasModule(t.module));
  const goTo = (route: string) => router.push(route as any);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-work-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Work</Text>
        <Text style={styles.subtitle}>Your tasks, ledger, and everything you record.</Text>

        {/* My Tasks / My Ledger — always available, never gated on a module. */}
        <Text style={styles.sectionLabel}>Me</Text>
        <View style={styles.grid}>
          <Pressable testID="emp-work-tile-my-tasks" onPress={() => router.push('/(emp)/tasks' as any)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
            <View style={styles.tileIcon}><Ionicons name="checkbox-outline" size={24} color={colors.brandPrimary} /></View>
            <Text style={styles.tileLabel}>My Tasks</Text>
          </Pressable>
          <Pressable testID="emp-work-tile-my-ledger" onPress={() => router.push(`/ledger/${user?.id}` as any)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
            <View style={styles.tileIcon}><Ionicons name="book-outline" size={24} color={colors.brandPrimary} /></View>
            <Text style={styles.tileLabel}>My Ledger</Text>
          </Pressable>
        </View>

        {showRepairDash && repairDash && (
          <DashCard
            testID="emp-repair-dashboard" title="Repairs" colors={colors} onPress={goTo}
            rows={buildRepairRows(repairDash)}
            caption={repairDash.delivered_today > 0 ? `${repairDash.delivered_today} delivered today` : undefined}
          />
        )}

        {showSampleDash && sampleDash && (
          <DashCard
            testID="emp-samples-dashboard" title="Stock In/Out" colors={colors} onPress={goTo}
            rows={buildSampleRows(sampleDash)}
            caption={sampleDash.received_today > 0 ? `${sampleDash.received_today} returned today` : undefined}
          />
        )}

        {opsTiles.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Operations</Text>
            <View style={styles.grid}>
              {opsTiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`emp-work-tile-${t.key}`}
                  onPress={() => router.push(t.route as any)}
                  style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
                >
                  <View style={styles.tileIcon}><Ionicons name={t.icon} size={24} color={colors.brandPrimary} /></View>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: 4 },
  subtitle: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.xl },
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
  dashHeaderRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: spacing.md, marginBottom: 6,
  },
  dashCaption: { color: colors.mutedText, fontSize: 10.5, fontWeight: '600' },
  dashCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  dashRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 8, minHeight: 36,
  },
  dashRowLast: { borderBottomWidth: 0 },
  dashIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dashLabel: { flex: 1, color: colors.onSurface, fontSize: 12.5, fontWeight: '600' },
  dashCount: { color: colors.onSurface, fontSize: 13.5, fontWeight: '800', marginRight: 1, minWidth: 16, textAlign: 'right' },
});
