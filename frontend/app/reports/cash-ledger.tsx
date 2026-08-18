import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type CashEntry = {
  id: string; type: 'receipt' | 'refund'; amount: number;
  item_id: string; item_code: string; customer_name: string; payment_mode: string;
  note: string; created_at: string; created_by: string;
};

// Every cash movement tied to a repair bill — what customers paid, and any
// refunds owed back to them (e.g. an item that came back lighter than it
// went in). This is the shop's cash-in/cash-out record for repairs, kept
// separate from the karigar and loss ledgers since it's a different party.
export default function CashLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [totalPaidOut, setTotalPaidOut] = useState(0);
  const [net, setNet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ entries: CashEntry[]; total_received: number; total_paid_out: number; net: number }>('/cash-ledger');
      setEntries(res.entries); setTotalReceived(res.total_received); setTotalPaidOut(res.total_paid_out); setNet(res.net);
    } catch (_e) { setEntries([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Quick per-payment-mode rollup — how much of what's been received is
  // cash vs UPI vs card, at a glance.
  const byMode = useMemo(() => {
    const map = new Map<string, { mode: string; received: number; refunded: number; count: number }>();
    for (const e of entries) {
      const row = map.get(e.payment_mode) || { mode: e.payment_mode, received: 0, refunded: 0, count: 0 };
      if (e.type === 'receipt') row.received += e.amount; else row.refunded += e.amount;
      row.count += 1;
      map.set(e.payment_mode, row);
    }
    return Array.from(map.values()).sort((a, b) => b.received - a.received);
  }, [entries]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cash-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Cash Ledger</Text>
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
              <Text style={[styles.summaryValue, { color: colors.onSuccess }]}>₹{totalReceived.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Received</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>₹{totalPaidOut.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Paid Out</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>₹{net.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Net</Text>
            </View>
          </View>

          {byMode.length > 0 && (
            <>
              <Text style={styles.section}>By Payment Mode</Text>
              {byMode.map((row) => (
                <View key={row.mode} style={styles.modeRow} testID={`cash-by-mode-${row.mode}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{(row.mode || 'cash').toUpperCase()}</Text>
                    <Text style={styles.cMeta}>{row.count} bill{row.count === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.modeValue, { color: colors.onSuccess }]}>+₹{row.received.toFixed(0)}</Text>
                    {row.refunded > 0 && <Text style={[styles.modeValue, { color: colors.onWarning }]}>-₹{row.refunded.toFixed(0)}</Text>}
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.section, { marginTop: spacing.md }]}>All Entries · {entries.length}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No repair cash entries yet</Text></View>
          ) : entries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => router.push(`/repairs/item/${e.item_id}` as any)}
              style={styles.entryRow}
              testID={`cash-entry-${e.id}`}
            >
              <View style={[styles.entryIcon, e.type === 'refund' && styles.entryIconWarning]}>
                <Ionicons name={e.type === 'receipt' ? 'trending-up-outline' : 'trending-down-outline'} size={16} color={e.type === 'receipt' ? colors.brandSecondary : colors.onWarning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{e.customer_name}{e.item_code ? ` · ${e.item_code}` : ''}</Text>
                <Text style={styles.cMeta}>{(e.payment_mode || 'cash').toUpperCase()} · {istDate(e.created_at)} · {e.created_by}</Text>
              </View>
              <Text style={[styles.entryValue, { color: e.type === 'receipt' ? colors.onSuccess : colors.onWarning }]}>
                {e.type === 'receipt' ? '+' : '-'}₹{e.amount.toFixed(0)}
              </Text>
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
  summaryValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },

  modeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  modeValue: { fontSize: 13, fontWeight: '700' },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  entryIconWarning: { backgroundColor: colors.surfaceTertiary },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { fontSize: 13, fontWeight: '700' },
});
