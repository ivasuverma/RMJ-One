import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type LossEntry = {
  id: string; karigar_id: string; karigar_name: string; weight: number; fine_weight: number;
  item_id?: string | null; item_code: string | null; note: string; created_at: string; created_by: string;
};

// Every declared process-loss entry across all karigars — an audit trail for
// how much gold is being written off as "loss" on receives, and by whom,
// rather than that figure sitting invisibly inside each receive transaction.
export default function LossLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<LossEntry[]>([]);
  const [totalWeight, setTotalWeight] = useState(0);
  const [totalFine, setTotalFine] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ entries: LossEntry[]; total_weight: number; total_fine_weight: number }>('/karigars/loss-ledger');
      setEntries(res.entries); setTotalWeight(res.total_weight); setTotalFine(res.total_fine_weight);
    } catch (_e) { setEntries([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Quick per-karigar rollup so a pattern (one karigar declaring most of the
  // loss) is visible at a glance above the full chronological list.
  const byKarigar = useMemo(() => {
    const map = new Map<string, { name: string; weight: number; fine: number; count: number }>();
    for (const e of entries) {
      const row = map.get(e.karigar_id) || { name: e.karigar_name || 'Unknown', weight: 0, fine: 0, count: 0 };
      row.weight += e.weight || 0; row.fine += e.fine_weight || 0; row.count += 1;
      map.set(e.karigar_id, row);
    }
    return Array.from(map.values()).sort((a, b) => b.fine - a.fine);
  }, [entries]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loss-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Loss Ledger</Text>
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
              <Text style={styles.summaryValue}>{totalWeight.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Total loss (gross)</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{totalFine.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Total loss (fine)</Text>
            </View>
          </View>

          {byKarigar.length > 0 && (
            <>
              <Text style={styles.section}>By Karigar</Text>
              {byKarigar.map((row) => (
                <View key={row.name} style={styles.karigarRow} testID={`loss-by-karigar-${row.name}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{row.name}</Text>
                    <Text style={styles.cMeta}>{row.count} receive{row.count === 1 ? '' : 's'}</Text>
                  </View>
                  <Text style={styles.karigarValue}>{row.fine.toFixed(3)}g fine</Text>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.section, { marginTop: spacing.md }]}>All Entries · {entries.length}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No loss declared yet</Text></View>
          ) : entries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => e.item_id && router.push(`/repairs/item/${e.item_id}` as any)}
              style={styles.entryRow}
              testID={`loss-entry-${e.id}`}
            >
              <View style={styles.entryIcon}><Ionicons name="trending-down-outline" size={16} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{e.karigar_name}{e.item_code ? ` · ${e.item_code}` : ''}</Text>
                <Text style={styles.cMeta}>{e.note || '—'} · {e.created_at?.slice(0, 10)} · {e.created_by}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.entryValue}>{e.weight.toFixed(3)}g</Text>
                <Text style={styles.entryFine}>fine {e.fine_weight.toFixed(3)}g</Text>
              </View>
            </Pressable>
          ))}
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

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },

  karigarRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  karigarValue: { color: colors.onWarning, fontSize: 13, fontWeight: '700' },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryFine: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
});
