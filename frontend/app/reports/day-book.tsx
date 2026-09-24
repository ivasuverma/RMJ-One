import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { LedgerFilter, filterQuery, type LedgerFilterValue } from '@/src/components/LedgerFilter';

type Voucher = {
  id: string; kind: 'karigar' | 'employee' | 'bill' | 'stock'; date: string; party: string; party_id?: string | null;
  job_id?: string | null; job?: string | null; label: string; note: string; fine_delta: number; amount_delta: number; by?: string; stock_weight?: number;
};
type Res = { entries: Voucher[]; next_cursor: string | null; count: number };

const KINDS: { key: string; label: string }[] = [
  { key: '', label: 'All' }, { key: 'karigar', label: 'Karigar' }, { key: 'employee', label: 'Employee' }, { key: 'bill', label: 'Bills' }, { key: 'stock', label: 'Stock' },
];
const ICON: Record<Voucher['kind'], keyof typeof Ionicons.glyphMap> = { karigar: 'hammer-outline', employee: 'people-outline', bill: 'receipt-outline', stock: 'diamond-outline' };

// The Day Book: every ledger entry from every book, newest first, in one list — the same entries the karigar,
// employee and customer screens show (it reads them, never copies them). Tap a row to open its job or party.
export default function DayBookScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<Voucher[]>([]);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState('');
  const [filter, setFilter] = useState<LedgerFilterValue>({ q: '', from: '', to: '' });
  const qs = [kind && `kind=${kind}`, filterQuery(filter)].filter(Boolean).join('&');

  const load = useCallback(async () => {
    try {
      const r = await api.get<Res>(`/daybook?limit=50${qs ? `&${qs}` : ''}`);
      setRows(r.entries); setCursor(r.next_cursor); setCount(r.count);
    } catch { setRows([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [qs]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } const t = setTimeout(load, 350); return () => clearTimeout(t); }, [qs]);

  const loadMore = async () => {
    if (!cursor || more) return;
    setMore(true);
    try {
      const r = await api.get<Res>(`/daybook?limit=50&cursor=${encodeURIComponent(cursor)}${qs ? `&${qs}` : ''}`);
      setRows((p) => [...p, ...r.entries]); setCursor(r.next_cursor);
    } catch { /* keep what is loaded */ }
    finally { setMore(false); }
  };

  const open = (v: Voucher) => {
    if (v.job_id) router.push(`/jobs/${v.job_id}` as any);
    else if (v.kind === 'karigar' && v.party_id) router.push(`/karigars/${v.party_id}` as any);
    else if (v.kind === 'employee' && v.party_id) router.push(`/ledger/${v.party_id}` as any);
    else if (v.kind === 'stock') router.push('/reports/metal-ledger' as any);
  };

  // Group by day, newest first.
  const days: { day: string; items: Voucher[] }[] = [];
  for (const v of rows) {
    const last = days[days.length - 1];
    if (last && last.day === v.date) last.items.push(v); else days.push({ day: v.date, items: [v] });
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="day-book-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Day Book</Text>
        <View style={{ width: 40 }} />
      </View>

      <LedgerFilter value={filter} onChange={setFilter} placeholder="Search party, tag or note" />
      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Pressable key={k.key} onPress={() => setKind(k.key)} style={[styles.chip, kind === k.key && styles.chipOn]} testID={`daybook-kind-${k.key || 'all'}`}>
            <Text style={[styles.chipText, kind === k.key && styles.chipTextOn]}>{k.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
          <Text style={styles.count}>{count} entr{count === 1 ? 'y' : 'ies'}</Text>
          {days.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>Nothing matches.</Text></View> : null}
          {days.map((d) => (
            <View key={d.day}>
              <Text style={styles.day}>{d.day ? istDate(d.day) : '—'}</Text>
              {d.items.map((v) => (
                <Pressable key={v.id} onPress={() => open(v)} style={styles.row} testID={`daybook-${v.id}`}>
                  <View style={styles.icon}><Ionicons name={ICON[v.kind]} size={18} color={colors.brandSecondary} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.party} numberOfLines={1}>{v.party || '—'}{v.job ? ` · ${v.job}` : ''}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{v.label}{v.note ? ` — ${v.note}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {Math.abs(v.fine_delta) >= 0.0005 ? <Text style={styles.val}>{v.fine_delta > 0 ? '+' : '−'}{Math.abs(v.fine_delta).toFixed(3)}g</Text> : null}
                    {Math.abs(v.amount_delta) >= 0.005 ? <Text style={styles.val}>{v.amount_delta > 0 ? '+' : '−'}₹{Math.abs(v.amount_delta).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Text> : null}
                    {v.kind === 'stock' && v.stock_weight != null ? <Text style={styles.val}>{v.stock_weight.toFixed(3)}g</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
          {cursor ? (
            <Pressable onPress={loadMore} disabled={more} style={styles.moreBtn} testID="daybook-load-more">
              {more ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Text style={styles.moreText}>Load more</Text>}
            </Pressable>
          ) : null}
          <Text style={styles.foot}>Fine gold: + means the karigar holds it. Money: + means the shop owes (for an employee: + salary owed, − advance or deduction). The Cash Book is a separate book.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  kinds: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: colors.onBrandPrimary },
  count: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm },
  day: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 6 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  party: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  val: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  moreBtn: { alignItems: 'center', paddingVertical: 14 },
  moreText: { color: colors.brandSecondary, fontWeight: '700' },
  foot: { color: colors.mutedText, fontSize: 11.5, marginTop: spacing.lg, lineHeight: 17 },
});
