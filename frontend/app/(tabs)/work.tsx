import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Skeleton, ErrorState } from '@/src/components/ui';

// Work — the operational hub, laid out to the v2 design comp: a search bar,
// an "In progress" list of process rows (each showing its live state before
// you tap), and a "Recently recorded" list so you can confirm a save without
// hunting. Reuses /api/dashboard (same source as Home) so the numbers agree.
type DashboardData = {
  repairs_summary: { received: number; with_karigar: number; ready: number; overdue: number; total_open: number };
  samples_summary: { with_karigar: number; overdue: number };
  cashbook_summary: { closing_balance: number };
  tasks_summary: { due_today: number; overdue: number };
  recent_activity?: { kind: 'repair' | 'cash' | 'stock' | 'ledger'; label: string; route: string }[];
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const RECENT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  repair: 'receipt-outline', cash: 'cash-outline', stock: 'diamond-outline', ledger: 'book-outline',
};

// One coloured segment of a process row's description.
type Seg = { text: string; tone?: string };

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setData(await api.get<DashboardData>('/dashboard')); }
    catch (e: any) { setError(e?.detail || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const go = (route: string) => router.push(route as any);

  type Row = { key: string; title: string; icon: string; segs: Seg[]; badge?: number; route: string; show: boolean };
  const rows: Row[] = data ? [
    {
      key: 'repairs', title: 'Repairs', icon: 'construct-outline', route: '/repairs', show: hasModule('repairs'),
      badge: data.repairs_summary.ready || undefined,
      segs: [
        { text: `${data.repairs_summary.with_karigar} with karigar`, tone: 'hot' },
        { text: ' · ' },
        { text: `${data.repairs_summary.overdue} overdue`, tone: 'bad' },
        { text: ' · ' },
        { text: `${data.repairs_summary.ready} to bill` },
      ],
    },
    {
      key: 'stock', title: 'Stock In / Out', icon: 'diamond-outline', route: '/samples', show: hasModule('samples'),
      segs: [
        { text: `${data.samples_summary.with_karigar} samples out` },
        { text: ' · ' },
        { text: `${data.samples_summary.overdue} overdue`, tone: 'bad' },
      ],
    },
    {
      key: 'cash', title: 'Cash Book', icon: 'wallet-outline', route: '/cashbook', show: hasModule('cash_book'),
      segs: [{ text: 'Closing ' }, { text: fmtINR(data.cashbook_summary.closing_balance), tone: 'strong' }],
    },
    {
      key: 'tasks', title: 'Tasks', icon: 'checkbox-outline', route: '/tasks', show: hasModule('tasks'),
      segs: [
        { text: `${data.tasks_summary.due_today} due today` },
        ...(data.tasks_summary.overdue > 0 ? [{ text: ' · ' }, { text: `${data.tasks_summary.overdue} overdue`, tone: 'bad' as const }] : []),
      ],
    },
  ].filter((r) => r.show) : [];

  const recent = data?.recent_activity?.slice(0, 4) || [];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="work-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Work</Text>
        <Text style={styles.sub}>What&apos;s in progress — and what to do next.</Text>

        <Pressable onPress={() => go('/repairs/search')} style={styles.search} testID="work-search">
          <Ionicons name="search-outline" size={17} color={colors.mutedText} />
          <Text style={styles.searchText}>Find a repair, sample or customer…</Text>
        </Pressable>

        {loading && !data ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} width="100%" height={72} radius={radius.md} />)}
          </View>
        ) : error ? (
          <View style={{ marginTop: spacing.lg }}><ErrorState message={error} onRetry={load} /></View>
        ) : (
          <>
            {rows.length > 0 && <Text style={styles.sectionLabel}>In progress</Text>}
            {rows.map((r) => (
              <Pressable key={r.key} onPress={() => go(r.route)} style={({ pressed }) => [styles.prow, pressed && { opacity: 0.85 }]} testID={`work-row-${r.key}`}>
                <View style={styles.pi}><Ionicons name={r.icon as keyof typeof Ionicons.glyphMap} size={22} color={colors.brandSecondary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pt}>{r.title}</Text>
                  <Text style={styles.pd} numberOfLines={1}>
                    {r.segs.map((s, i) => (
                      <Text key={i} style={s.tone === 'hot' ? { color: colors.onWarning } : s.tone === 'bad' ? { color: colors.onError } : s.tone === 'strong' ? { color: colors.onSurface, fontWeight: '700' } : undefined}>
                        {s.text}
                      </Text>
                    ))}
                  </Text>
                </View>
                {r.badge ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{r.badge}</Text></View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
                )}
              </Pressable>
            ))}

            {recent.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Recently recorded</Text>
                <View style={styles.group}>
                  {recent.map((r, i) => (
                    <Pressable key={i} onPress={() => go(r.route)} style={({ pressed }) => [styles.li, i > 0 && styles.liBorder, pressed && { opacity: 0.7 }]} testID={`work-recent-${i}`}>
                      <View style={styles.gi}><Ionicons name={RECENT_ICON[r.kind] || 'ellipse-outline'} size={15} color={colors.brandSecondary} /></View>
                      <Text style={styles.gt} numberOfLines={1}>{r.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {rows.length === 0 && recent.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="briefcase-outline" size={34} color={colors.mutedText} />
                <Text style={styles.emptyText}>Nothing assigned to you yet.</Text>
              </View>
            )}
          </>
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  h1: { color: colors.onSurface, fontSize: 30, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 46,
  },
  searchText: { color: colors.mutedText, fontSize: 15 },

  sectionLabel: {
    color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.md,
  },

  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800' },

  group: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  li: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: spacing.md },
  liBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  gi: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  gt: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '500' },

  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary },
});
