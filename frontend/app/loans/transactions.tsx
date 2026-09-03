import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth/AuthContext';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Txn = { id: string; type: 'interest_due' | 'payment_interest' | 'payment_principal'; amount: number; date: string; note: string; auto: boolean; created_by: string; created_at: string };
type Page = { items: Txn[]; total: number; skip: number; limit: number };

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const TXN_LABEL: Record<Txn['type'], string> = { interest_due: 'Interest posted', payment_interest: 'Interest received', payment_principal: 'Principal received' };
const PAGE_SIZE = 20;

// Paginated transaction ledger for one gold loan, split out of the (now
// summary-only) loan detail screen. Each entry can be edited or deleted
// in place — the amount/date/note only, not the type, since retagging
// interest vs principal after the fact would distort the derived balances.
export default function GoldLoanTransactionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canEdit = hasRight('gold_loans', 'edit');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [txns, setTxns] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await api.get<Page>(`/gold-loans/${id}/transactions?skip=0&limit=${PAGE_SIZE}`);
      setTxns(page.items); setTotal(page.total);
    } catch (_e) { /* keep whatever was already loaded */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { loadFirstPage(); }, [loadFirstPage]));

  const loadMore = async () => {
    if (loadingMore || txns.length >= total) return;
    setLoadingMore(true);
    try {
      const page = await api.get<Page>(`/gold-loans/${id}/transactions?skip=${txns.length}&limit=${PAGE_SIZE}`);
      setTxns((prev) => [...prev, ...page.items]); setTotal(page.total);
    } catch (_e) { /* leave list as-is, user can retry via scroll */ }
    finally { setLoadingMore(false); }
  };

  // Inline edit — one row open at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eAmount, setEAmount] = useState('');
  const [eDate, setEDate] = useState('');
  const [eNote, setENote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const openEdit = (t: Txn) => { setEditingId(t.id); setEAmount(String(t.amount)); setEDate(t.date); setENote(t.note || ''); };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (txnId: string) => {
    const amt = parseFloat(eAmount);
    if (!amt || amt <= 0) { notify('Missing', 'Enter an amount greater than 0'); return; }
    setSavingEdit(true);
    try {
      await api.put(`/gold-loans/${id}/transactions/${txnId}`, { amount: amt, date: eDate, note: eNote.trim() });
      setEditingId(null);
      await loadFirstPage();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSavingEdit(false); }
  };
  const removeTxn = (t: Txn) => {
    confirmAction('Delete this entry?', `Remove the ${TXN_LABEL[t.type].toLowerCase()} of ${fmtINR(t.amount)} on ${t.date}? This cannot be undone.`, 'Delete', async () => {
      try { await api.del(`/gold-loans/${id}/transactions/${t.id}`); await loadFirstPage(); }
      catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-transactions-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Transactions{total ? ` (${total})` : ''}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFirstPage(); }} tintColor={colors.brandPrimary} />}
        >
          {txns.length === 0 ? (
            <Text style={styles.subMeta}>No interest or payments recorded yet.</Text>
          ) : txns.map((t) => (
            <View key={t.id} style={styles.txnCard} testID={`txn-${t.id}`}>
              {editingId === t.id ? (
                <View style={{ width: '100%' }}>
                  <Text style={styles.label}>Amount (₹)</Text>
                  <TextInput testID={`txn-edit-amount-${t.id}`} value={eAmount} onChangeText={(v) => setEAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} />
                  <DateField label="Date" value={eDate} onChange={setEDate} testID={`txn-edit-date-${t.id}`} />
                  <Text style={styles.label}>Note</Text>
                  <TextInput testID={`txn-edit-note-${t.id}`} value={eNote} onChangeText={setENote} style={styles.input} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <Pressable onPress={() => saveEdit(t.id)} disabled={savingEdit} style={[styles.smallBtn, styles.smallBtnPrimary, { flex: 1 }]} testID={`txn-save-${t.id}`}>
                      {savingEdit ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.smallBtnPrimaryText}>Save</Text>}
                    </Pressable>
                    <Pressable onPress={cancelEdit} style={[styles.smallBtn, { flex: 1 }]} testID={`txn-cancel-${t.id}`}>
                      <Text style={styles.smallBtnText}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnLabel}>{TXN_LABEL[t.type]}{t.auto ? ' (auto)' : ''}</Text>
                    <Text style={styles.txnMeta}>{t.date} · {t.created_by}{t.note ? ` · ${t.note}` : ''}</Text>
                    {canEdit && (
                      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: 6 }}>
                        <Pressable onPress={() => openEdit(t)} testID={`txn-edit-${t.id}`} hitSlop={8}>
                          <Text style={styles.txnActionText}>Edit</Text>
                        </Pressable>
                        <Pressable onPress={() => removeTxn(t)} testID={`txn-delete-${t.id}`} hitSlop={8}>
                          <Text style={[styles.txnActionText, { color: colors.onError }]}>Delete</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.txnAmount, t.type === 'interest_due' ? { color: colors.onWarning } : { color: colors.onSuccess }]}>
                    {t.type === 'interest_due' ? '+' : '−'}{fmtINR(t.amount)}
                  </Text>
                </>
              )}
            </View>
          ))}

          {txns.length < total && (
            <Pressable onPress={loadMore} disabled={loadingMore} style={styles.loadMoreBtn} testID="load-more-txns-btn">
              {loadingMore ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <Text style={styles.loadMoreText}>Load more ({total - txns.length} more)</Text>}
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

  subMeta: { color: colors.mutedText, fontSize: 13 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.sm, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14,
  },

  txnCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  txnLabel: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  txnMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  txnAmount: { fontSize: 14, fontWeight: '800' },
  txnActionText: { color: colors.brandPrimary, fontSize: 11, fontWeight: '700' },

  smallBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 10 },
  smallBtnText: { color: colors.mutedText, fontWeight: '700', fontSize: 12 },
  smallBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  smallBtnPrimaryText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },

  loadMoreBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 12 },
});
