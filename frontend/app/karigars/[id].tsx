import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };
type Entry = {
  id: string; type: 'gold_out' | 'gold_in' | 'wastage' | 'labour_payable' | 'payment' | 'receipt';
  weight: number | null; amount: number | null; item_id?: string | null; item_code: string | null; note: string; created_at: string; created_by: string;
};

const ENTRY_LABEL: Record<Entry['type'], string> = {
  gold_out: 'Gold issued', gold_in: 'Gold received', wastage: 'Wastage adjustment', labour_payable: 'Labour payable', payment: 'Payment made', receipt: 'Cash received',
};
const ENTRY_ICON: Record<Entry['type'], any> = {
  gold_out: 'arrow-redo-outline', gold_in: 'arrow-undo-outline', wastage: 'trending-down-outline', labour_payable: 'cash-outline', payment: 'checkmark-circle-outline', receipt: 'download-outline',
};

export default function KarigarLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigar, setKarigar] = useState<Karigar | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weightBalance, setWeightBalance] = useState(0);
  const [amountDue, setAmountDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ karigar: Karigar; entries: Entry[]; weight_balance: number; amount_due: number }>(`/karigars/${id}/ledger`);
      setKarigar(res.karigar); setEntries(res.entries); setWeightBalance(res.weight_balance); setAmountDue(res.amount_due);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const removeEntry = (e: Entry) => {
    confirmAction(
      'Delete entry?',
      `Remove this ${ENTRY_LABEL[e.type].toLowerCase()} entry? This cannot be undone.`,
      'Delete',
      async () => {
        setDeletingId(e.id);
        try { await api.del(`/karigars/${id}/ledger/${e.id}`); await load(); }
        catch (err: any) { Alert.alert('Failed', err?.detail || 'Could not delete this entry.'); }
        finally { setDeletingId(''); }
      },
    );
  };

  if (loading || !karigar) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigar-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{karigar.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{weightBalance.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Gold with karigar</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, amountDue > 0 && { color: colors.onWarning }]}>₹{amountDue.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Amount due</Text>
            </View>
          </View>

          <Text style={styles.section}>History · {entries.length}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No ledger entries yet</Text></View>
          ) : entries.map((e) => (
            <View key={e.id} style={styles.entryRow} testID={`entry-${e.id}`}>
              <View style={styles.entryIcon}><Ionicons name={ENTRY_ICON[e.type]} size={16} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>{ENTRY_LABEL[e.type]}{e.item_code ? ` · ${e.item_code}` : ''}</Text>
                <Text style={styles.entryMeta}>{e.note || '—'} · {e.created_at?.slice(0, 10)} · {e.created_by}</Text>
              </View>
              <Text style={styles.entryValue}>
                {e.weight != null ? `${e.weight.toFixed(3)}g` : e.amount != null ? `₹${Math.abs(e.amount).toFixed(0)}` : ''}
              </Text>
              {!e.item_id && (
                <Pressable onPress={() => removeEntry(e)} disabled={deletingId === e.id} style={styles.entryDelBtn} hitSlop={8} testID={`del-entry-${e.id}`}>
                  {deletingId === e.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={14} color={colors.onError} />}
                </Pressable>
              )}
            </View>
          ))}
      </ScrollView>
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

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryDelBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs,
  },
});
