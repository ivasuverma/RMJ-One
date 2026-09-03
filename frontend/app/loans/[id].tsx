import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/auth/AuthContext';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { confirmAction } from '@/src/utils/confirm';
import { istDateTime } from '@/src/utils/datetime';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Txn = { id: string; type: 'interest_due' | 'payment_interest' | 'payment_principal'; amount: number; date: string; note: string; auto: boolean; created_by: string; created_at: string };
type Loan = {
  id: string; loan_no: string; customer_name: string; customer_mobile: string;
  description: string; weight: number; pc_count: number; photo: string;
  principal: number; interest_rate_percent: number;
  loan_date: string; estimate_return_date: string | null;
  status: 'active' | 'closed'; closed_at: string | null; closed_by: string | null;
  note: string; created_at: string; created_by: string;
  principal_paid: number; principal_balance: number;
  interest_due: number; interest_paid: number; interest_balance: number; total_outstanding: number;
  transactions: Txn[];
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const TXN_LABEL: Record<Txn['type'], string> = { interest_due: 'Interest posted', payment_interest: 'Interest received', payment_principal: 'Principal received' };

export default function GoldLoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canEdit = hasRight('gold_loans', 'edit');
  const canDelete = hasRight('gold_loans', 'delete');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    try { setError(''); setLoan(await api.get<Loan>(`/gold-loans/${id}`)); }
    catch (e: any) { setError(e?.detail || 'Failed to load loan'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Payment form
  const [payAmount, setPayAmount] = useState('');
  const [payType, setPayType] = useState<'interest' | 'principal'>('interest');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);

  const recordPayment = async () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { Alert.alert('Missing', 'Enter an amount greater than 0'); return; }
    setPaying(true);
    try {
      await api.post(`/gold-loans/${id}/payment`, { amount: amt, type: payType, note: payNote.trim() });
      setPayAmount(''); setPayNote('');
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setPaying(false); }
  };

  const closeLoan = () => {
    if (!loan) return;
    confirmAction('Close this loan?', `Marks ${loan.loan_no} as redeemed — the customer collects the pledge back.`, 'Close Loan', async () => {
      setClosing(true);
      try { await api.post(`/gold-loans/${id}/close`, {}); await load(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
      finally { setClosing(false); }
    });
  };

  const remove = () => {
    if (!loan) return;
    confirmAction('Delete loan?', `Remove ${loan.loan_no}? Only possible before any interest or payment has been recorded. This cannot be undone.`, 'Delete', async () => {
      setDeleting(true);
      try { await api.del(`/gold-loans/${id}`); router.back(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
      finally { setDeleting(false); }
    });
  };

  const printThermal = async () => {
    try { await api.post(`/gold-loans/${id}/voucher/print`, {}); }
    catch (e: any) { Alert.alert('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
  };
  const [printingPdf, setPrintingPdf] = useState(false);
  const printPdf = async () => {
    setPrintingPdf(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/gold-loans/${id}/voucher/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Print failed (${res.status})`);
      if (Platform.OS === 'web') { const blob = await res.blob(); window.open(URL.createObjectURL(blob), '_blank'); }
      else Alert.alert('Ready', 'PDF preview is available on the web app.');
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrintingPdf(false); }
  };

  // Edit (limited fields — principal/rate/customer are fixed once created)
  const [showEdit, setShowEdit] = useState(false);
  const [eDescription, setEDescription] = useState('');
  const [eWeight, setEWeight] = useState('');
  const [ePcCount, setEPcCount] = useState('');
  const [eEstimateDate, setEEstimateDate] = useState('');
  const [eNote, setENote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const openEdit = () => {
    if (!loan) return;
    setEDescription(loan.description); setEWeight(String(loan.weight)); setEPcCount(String(loan.pc_count));
    setEEstimateDate(loan.estimate_return_date || ''); setENote(loan.note || '');
    setShowEdit(true);
  };
  const saveEdit = async () => {
    const w = parseFloat(eWeight);
    if (!eDescription.trim() || !w || w <= 0) { Alert.alert('Missing', 'Description and weight are required'); return; }
    setSavingEdit(true);
    try {
      await api.put(`/gold-loans/${id}`, {
        description: eDescription.trim(), weight: w, pc_count: parseInt(ePcCount, 10) || 1,
        estimate_return_date: eEstimateDate || null, note: eNote,
      });
      setShowEdit(false); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSavingEdit(false); }
  };

  if (loading || !loan) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} /><View style={{ width: 40 }} />
        </View>
        {loading ? <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
          : <View style={{ padding: spacing.lg }}><ErrorState message={error || 'Loan not found'} onRetry={load} testID="loan-error" /></View>}
      </SafeAreaView>
    );
  }

  const isActive = loan.status === 'active';
  const canClose = isActive && loan.total_outstanding <= 0.01;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{loan.loan_no}</Text>
        {isActive && canEdit && (
          <Pressable onPress={openEdit} style={styles.iconBtn} testID="edit-loan-btn" hitSlop={12}>
            <Ionicons name="pencil-outline" size={18} color={colors.onSurface} />
          </Pressable>
        )}
        {canDelete && (
          <Pressable onPress={remove} disabled={deleting} style={styles.iconBtn} testID="delete-loan-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.badge, loan.status === 'closed' ? styles.badgeClosed : styles.badgeActive, { alignSelf: 'flex-start' }]}>
            <Text style={[styles.badgeText, loan.status === 'closed' ? styles.badgeTextClosed : styles.badgeTextActive]}>
              {loan.status === 'closed' ? 'Closed' : 'Active'}
            </Text>
          </View>

          {loan.photo ? <Image source={{ uri: loan.photo }} style={styles.photo} /> : null}
          <RecordPhotos refType="gold_loan" refId={loan.id} label="Photos" />

          <Text style={styles.description}>{loan.description}</Text>
          <Text style={styles.subMeta}>{loan.customer_name} · {loan.customer_mobile} · {loan.weight.toFixed(3)}g · {loan.pc_count} pc{loan.pc_count === 1 ? '' : 's'}</Text>

          <View style={styles.balanceCard}>
            <View style={styles.balRow}><Text style={styles.balLabel}>Principal</Text><Text style={styles.balValue}>{fmtINR(loan.principal)}</Text></View>
            <View style={styles.balRow}><Text style={styles.balLabel}>Principal paid</Text><Text style={styles.balValue}>{fmtINR(loan.principal_paid)}</Text></View>
            <View style={styles.balRow}><Text style={styles.balLabel}>Principal balance</Text><Text style={[styles.balValue, loan.principal_balance > 0 && { color: colors.onWarning }]}>{fmtINR(loan.principal_balance)}</Text></View>
            <View style={[styles.balRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 }]}><Text style={styles.balLabel}>Interest due (total posted)</Text><Text style={styles.balValue}>{fmtINR(loan.interest_due)}</Text></View>
            <View style={styles.balRow}><Text style={styles.balLabel}>Interest paid</Text><Text style={styles.balValue}>{fmtINR(loan.interest_paid)}</Text></View>
            <View style={styles.balRow}><Text style={styles.balLabel}>Interest balance</Text><Text style={[styles.balValue, loan.interest_balance > 0 && { color: colors.onWarning }]}>{fmtINR(loan.interest_balance)}</Text></View>
            <View style={[styles.balRow, { marginTop: 6 }]}><Text style={styles.balTotalLabel}>Total outstanding</Text><Text style={styles.balTotalValue}>{fmtINR(loan.total_outstanding)}</Text></View>
          </View>

          <View style={styles.detailCard}>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Interest rate</Text><Text style={styles.detailValue}>{loan.interest_rate_percent.toFixed(2)}% / month</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Loan date</Text><Text style={styles.detailValue}>{loan.loan_date}</Text></View>
            {!!loan.estimate_return_date && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Est. return</Text><Text style={styles.detailValue}>{loan.estimate_return_date}</Text></View>
            )}
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Created</Text><Text style={styles.detailValue}>{istDateTime(loan.created_at)} · {loan.created_by}</Text></View>
            {loan.closed_at && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Closed</Text><Text style={styles.detailValue}>{istDateTime(loan.closed_at)} · {loan.closed_by}</Text></View>
            )}
            {!!loan.note && (
              <View style={[styles.detailRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 4 }]}>
                <Text style={styles.detailLabel}>Note</Text><Text style={styles.detailValue}>{loan.note}</Text>
              </View>
            )}
          </View>

          {showEdit && (
            <View style={styles.formCard} testID="edit-loan-form">
              <Text style={styles.label}>Description</Text>
              <TextInput testID="edit-description" value={eDescription} onChangeText={setEDescription} placeholderTextColor={colors.mutedText} style={styles.input} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Weight (g)</Text>
                  <TextInput testID="edit-weight" value={eWeight} onChangeText={(v) => setEWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Pieces</Text>
                  <TextInput testID="edit-pc-count" value={ePcCount} onChangeText={(v) => setEPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
              </View>
              <DateField label="Estimated return date" value={eEstimateDate} onChange={setEEstimateDate} testID="edit-estimate-date" />
              <Text style={styles.label}>Note</Text>
              <TextInput testID="edit-note" value={eNote} onChangeText={setENote} placeholderTextColor={colors.mutedText} style={styles.input} multiline />
              <Pressable style={[styles.primaryBtn, savingEdit && { opacity: 0.6 }]} disabled={savingEdit} onPress={saveEdit} testID="save-edit-loan-btn">
                {savingEdit ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Save Changes</Text>}
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowEdit(false)} testID="cancel-edit-loan-btn">
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={printPdf} disabled={printingPdf} style={[styles.actionBtn, { flex: 1 }]} testID="print-loan-pdf-btn">
              {printingPdf ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print PDF</Text></>}
            </Pressable>
            <Pressable onPress={printThermal} style={[styles.actionBtn, { flex: 1 }]} testID="print-loan-btn">
              <Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Receipt</Text>
            </Pressable>
          </View>

          {isActive && (
            <View style={styles.payCard} testID="loan-payment-form">
              <Text style={styles.formHeaderText}>Record Payment</Text>
              <View style={styles.chipRow}>
                <Pressable onPress={() => setPayType('interest')} style={[styles.chip, payType === 'interest' && styles.chipActive]} testID="pay-type-interest">
                  <Text style={[styles.chipText, payType === 'interest' && styles.chipTextActive]}>Interest</Text>
                </Pressable>
                <Pressable onPress={() => setPayType('principal')} style={[styles.chip, payType === 'principal' && styles.chipActive]} testID="pay-type-principal">
                  <Text style={[styles.chipText, payType === 'principal' && styles.chipTextActive]}>Principal / Redemption</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>Amount (₹)</Text>
              <TextInput testID="pay-amount" value={payAmount} onChangeText={(v) => setPayAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="pay-note" value={payNote} onChangeText={setPayNote} placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={recordPayment} disabled={paying} style={[styles.primaryBtn, paying && { opacity: 0.6 }]} testID="record-payment-btn">
                {paying ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Record Payment</Text>}
              </Pressable>
            </View>
          )}

          {isActive && (
            <Pressable
              style={[styles.primaryBtn, !canClose && { opacity: 0.4 }]} disabled={!canClose || closing}
              onPress={closeLoan} testID="close-loan-btn"
            >
              {closing ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <Text style={styles.primaryBtnText}>{canClose ? 'Close Loan — Collected by Customer' : `Clear ${fmtINR(loan.total_outstanding)} to close`}</Text>
              )}
            </Pressable>
          )}

          <Text style={[styles.formHeaderText, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>History</Text>
          {loan.transactions.length === 0 ? (
            <Text style={styles.subMeta}>No interest or payments recorded yet.</Text>
          ) : loan.transactions.map((t) => (
            <View key={t.id} style={styles.txnRow} testID={`txn-${t.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnLabel}>{TXN_LABEL[t.type]}{t.auto ? ' (auto)' : ''}</Text>
                <Text style={styles.txnMeta}>{t.date} · {t.created_by}{t.note ? ` · ${t.note}` : ''}</Text>
              </View>
              <Text style={[styles.txnAmount, t.type === 'interest_due' ? { color: colors.onWarning } : { color: colors.onSuccess }]}>
                {t.type === 'interest_due' ? '+' : '−'}{fmtINR(t.amount)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, marginBottom: spacing.md },
  badgeActive: { backgroundColor: colors.brandTertiary },
  badgeClosed: { backgroundColor: colors.success },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextActive: { color: colors.brandSecondary },
  badgeTextClosed: { color: colors.onSuccess },

  photo: { width: '100%', height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, marginBottom: spacing.md },
  description: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display, marginTop: spacing.sm },
  subMeta: { color: colors.mutedText, fontSize: 13, marginTop: 2, marginBottom: spacing.md },

  balanceCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  balRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  balLabel: { color: colors.mutedText, fontSize: 12 },
  balValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  balTotalLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '800' },
  balTotalValue: { color: colors.brandSecondary, fontSize: 16, fontWeight: '800' },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: colors.mutedText, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  payCard: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.md },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  secondaryBtn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  secondaryBtnText: { color: colors.mutedText, fontWeight: '700', fontSize: 13 },
  actionBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, marginTop: spacing.lg,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },

  txnRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  txnLabel: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  txnMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  txnAmount: { fontSize: 14, fontWeight: '800' },
});
