import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type MetalType = 'in' | 'out' | 'loss';
type MetalEntry = {
  id: string; type: MetalType; weight: number; karigar_id?: string | null; karigar_name?: string | null;
  item_id?: string | null; item_code: string | null; note: string; created_at: string; created_by: string;
};
type ByKarigar = { karigar_id: string; name: string; in: number; out: number; loss: number; count: number };
type MetalLedgerRes = {
  entries: MetalEntry[]; next_cursor: string | null; by_karigar: ByKarigar[];
  total_in: number; total_out: number; total_loss: number; balance: number;
};

const TYPE_LABEL: Record<MetalType, string> = { in: 'Received', out: 'Issued', loss: 'Loss' };
const TYPE_ICON: Record<MetalType, keyof typeof Ionicons.glyphMap> = {
  in: 'arrow-down-circle-outline', out: 'arrow-up-circle-outline', loss: 'trending-down-outline',
};

// The shop's own gold stock — the double-entry counter-side of every
// gold_out/gold_in posted to a karigar's ledger (post_gold_ledger_entry in
// server.py), plus every declared loss shown alongside for the complete
// picture. Balance = total in - total out; loss is informational only
// (the gold it represents already left via the original issue), same
// convention as a karigar's own fine balance.
export default function MetalLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<MetalEntry[]>([]);
  const [byKarigar, setByKarigar] = useState<ByKarigar[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [totalLoss, setTotalLoss] = useState(0);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<MetalLedgerRes>('/metal-ledger');
      setEntries(res.entries); setNextCursor(res.next_cursor); setByKarigar(res.by_karigar);
      setTotalIn(res.total_in); setTotalOut(res.total_out); setTotalLoss(res.total_loss); setBalance(res.balance);
    } catch (_e) { setEntries([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get<MetalLedgerRes>(`/metal-ledger?cursor=${encodeURIComponent(nextCursor)}`);
      setEntries((prev) => [...prev, ...res.entries]);
      setNextCursor(res.next_cursor);
    } catch (_e) { /* keep what's already loaded */ }
    finally { setLoadingMore(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="metal-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Metal Ledger</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: colors.onSuccess }]}>{totalIn.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Received</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>{totalOut.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Issued</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{balance.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Net Stock</Text>
            </View>
          </View>
          {totalLoss > 0.001 && (
            <View style={styles.lossBanner} testID="metal-ledger-total-loss">
              <Ionicons name="trending-down-outline" size={16} color={colors.onError} />
              <Text style={styles.lossBannerText}>{totalLoss.toFixed(3)}g written off as loss (doesn't affect Net Stock)</Text>
            </View>
          )}

          {byKarigar.length > 0 && (
            <>
              <Text style={styles.section}>By Karigar</Text>
              {byKarigar.map((row) => (
                <View key={row.karigar_id} style={styles.karigarRow} testID={`metal-by-karigar-${row.karigar_id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{row.name}</Text>
                    <Text style={styles.cMeta}>{row.count} transaction{row.count === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.karigarValueIn}>+{row.in.toFixed(3)}g · −{row.out.toFixed(3)}g</Text>
                    {row.loss > 0.001 && <Text style={styles.karigarValueLoss}>{row.loss.toFixed(3)}g loss</Text>}
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.section, { marginTop: spacing.md }]}>Entries · {entries.length}{nextCursor ? '+' : ''}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No metal movements yet</Text></View>
          ) : entries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => e.item_id && router.push(`/repairs/item/${e.item_id}` as any)}
              style={styles.entryRow}
              testID={`metal-entry-${e.id}`}
            >
              <View style={[styles.entryIcon, e.type === 'loss' && styles.entryIconLoss]}>
                <Ionicons name={TYPE_ICON[e.type]} size={16} color={e.type === 'loss' ? colors.onError : colors.brandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{TYPE_LABEL[e.type]}{e.karigar_name ? ` · ${e.karigar_name}` : ''}{e.item_code ? ` · ${e.item_code}` : ''}</Text>
                <Text style={styles.cMeta}>{e.note || '—'} · {istDate(e.created_at)} · {e.created_by}</Text>
              </View>
              <Text style={[styles.entryValue, e.type === 'out' && { color: colors.onWarning }, e.type === 'in' && { color: colors.onSuccess }, e.type === 'loss' && { color: colors.onError }]}>
                {e.type === 'out' ? '−' : '+'}{e.weight.toFixed(3)}g
              </Text>
            </Pressable>
          ))}
          {!!nextCursor && (
            <Pressable onPress={loadMore} disabled={loadingMore} style={styles.loadMoreBtn} testID="metal-ledger-load-more">
              {loadingMore ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.loadMoreText}>Load more</Text>}
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  lossBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.lg,
  },
  lossBannerText: { color: colors.onError, fontSize: 11.5, fontWeight: '600', flex: 1 },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },

  karigarRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  karigarValueIn: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700' },
  karigarValueLoss: { color: colors.onError, fontSize: 11, marginTop: 2 },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  entryIconLoss: { backgroundColor: colors.error },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  loadMoreBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, marginTop: spacing.xs,
  },
  loadMoreText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
