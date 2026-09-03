import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/auth/AuthContext';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { confirmAction } from '@/src/utils/confirm';
import { istDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type InterestMonth = { period: string; date: string; amount: number; paid: boolean };
type Loan = {
  id: string; loan_no: string; customer_name: string; customer_mobile: string;
  description: string; weight: number; pc_count: number; photo: string;
  principal: number; interest_rate_percent: number;
  loan_date: string; estimate_return_date: string | null;
  status: 'active' | 'closed'; closed_at: string | null; closed_by: string | null;
  note: string; created_at: string; created_by: string;
  principal_paid: number; principal_balance: number;
  interest_due: number; interest_paid: number; interest_balance: number; total_outstanding: number;
  interest_months_total: number; interest_months_received: number; interest_months_pending: number;
  interest_months: InterestMonth[];
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// This screen is summary only — balances, terms, and an at-a-glance
// interest calendar. Recording a payment and browsing/editing the full
// transaction ledger both live on their own screens (loans/transact.tsx,
// loans/transactions.tsx) so this page stays a fast, light single fetch
// instead of pulling every transaction up front.
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

  // Interest calendar — year picker + a selected-month detail sheet, same
  // pattern as AttendanceCalendarView's month view, just one level up (a
  // whole year of months instead of a month of days), since interest here
  // is booked per calendar month, not per day.
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calSelected, setCalSelected] = useState<InterestMonth | null>(null);
  useEffect(() => {
    if (loan && loan.interest_months.length > 0) {
      const years = loan.interest_months.map((m) => parseInt(m.period.slice(0, 4), 10));
      setCalYear(years[years.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id]);

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

  // Month-number -> entry for the currently-viewed year only — the year
  // stepper (below) swaps this out instead of rendering every year at once.
  const calMonthByNum: Record<string, InterestMonth> = {};
  loan.interest_months.forEach((m) => {
    const [y, mm] = m.period.split('-');
    if (parseInt(y, 10) === calYear) calMonthByNum[mm] = m;
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{loan.loan_no}</Text>
        {isActive && canEdit && (
          <Pressable onPress={() => router.push(`/loans/new?id=${loan.id}` as any)} style={styles.iconBtn} testID="edit-loan-btn" hitSlop={12}>
            <Ionicons name="pencil-outline" size={18} color={colors.onSurface} />
          </Pressable>
        )}
        {canDelete && (
          <Pressable onPress={remove} disabled={deleting} style={styles.iconBtn} testID="delete-loan-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
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
          <View style={styles.balRow}><Text style={styles.balLabel}>Interest months received / pending</Text><Text style={styles.balValue}>{loan.interest_months_received} / {loan.interest_months_pending}</Text></View>
          <View style={[styles.balRow, { marginTop: 6 }]}><Text style={styles.balTotalLabel}>Total outstanding</Text><Text style={styles.balTotalValue}>{fmtINR(loan.total_outstanding)}</Text></View>
        </View>

        <View style={styles.calCard} testID="interest-calendar">
          <Text style={styles.formHeaderText}>Interest Calendar</Text>

          <View style={styles.calYearRow}>
            <Pressable onPress={() => setCalYear((y) => y - 1)} style={styles.calYearNav} testID="cal-prev-year">
              <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.calYearLabel}>{calYear}</Text>
            <Pressable onPress={() => setCalYear((y) => y + 1)} style={styles.calYearNav} testID="cal-next-year">
              <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.calGrid}>
            {MONTHS.map((lbl, i) => {
              const mm = String(i + 1).padStart(2, '0');
              const cell = calMonthByNum[mm];
              const cellStyle = cell ? (cell.paid ? styles.calCellPaid : styles.calCellPending) : styles.calCellEmpty;
              const textStyle = cell ? (cell.paid ? styles.calCellTextPaid : styles.calCellTextPending) : styles.calCellTextEmpty;
              return (
                <Pressable
                  key={mm} style={styles.calCellWrap} testID={`cal-${calYear}-${mm}`}
                  onPress={() => cell && setCalSelected(cell)} disabled={!cell}
                >
                  <View style={[styles.calCell, cellStyle]}>
                    <Text style={[styles.calCellText, textStyle]}>{lbl}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, styles.calCellPending]} /><Text style={styles.legendText}>Pending</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, styles.calCellPaid]} /><Text style={styles.legendText}>Received</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, styles.calCellEmpty]} /><Text style={styles.legendText}>Not due yet</Text></View>
          </View>
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

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable onPress={printPdf} disabled={printingPdf} style={[styles.actionBtn, { flex: 1 }]} testID="print-loan-pdf-btn">
            {printingPdf ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print PDF</Text></>}
          </Pressable>
          <Pressable onPress={printThermal} style={[styles.actionBtn, { flex: 1 }]} testID="print-loan-btn">
            <Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Receipt</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {isActive && (
            <Pressable onPress={() => router.push(`/loans/transact?id=${loan.id}` as any)} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="record-payment-btn">
              <Ionicons name="cash-outline" size={16} color={colors.onBrandPrimary} /><Text style={[styles.actionBtnText, { color: colors.onBrandPrimary }]}>Record Payment</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.push(`/loans/transactions?id=${loan.id}` as any)} style={[styles.actionBtn, { flex: 1 }]} testID="view-transactions-btn">
            <Ionicons name="list-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Transactions</Text>
          </Pressable>
        </View>

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
      </ScrollView>

      {calSelected && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setCalSelected(null)}>
          <View style={styles.modalBg}>
            <Pressable style={{ flex: 1 }} onPress={() => setCalSelected(null)} />
            <View style={styles.sheet} testID="cal-month-sheet">
              <View style={styles.sheetGrip} />
              <Text style={styles.sheetTitle}>{MONTHS[parseInt(calSelected.period.slice(5, 7), 10) - 1]} {calSelected.period.slice(0, 4)}</Text>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Amount</Text><Text style={styles.detailValue}>{fmtINR(calSelected.amount)}</Text></View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Due date</Text><Text style={styles.detailValue}>{calSelected.date}</Text></View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={[styles.detailValue, calSelected.paid ? { color: colors.onSuccess } : { color: colors.onError }]}>
                  {calSelected.paid ? 'Received' : 'Pending'}
                </Text>
              </View>
              {!calSelected.paid && isActive && (
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => { setCalSelected(null); router.push(`/loans/transact?id=${loan.id}&type=interest&amount=${calSelected.amount}` as any); }}
                  testID="cal-record-payment-btn"
                >
                  <Text style={styles.primaryBtnText}>Record Payment</Text>
                </Pressable>
              )}
              <Pressable style={styles.secondaryBtn} onPress={() => setCalSelected(null)} testID="cal-close-btn">
                <Text style={styles.secondaryBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
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

  calCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  calYearRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  calYearNav: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  calYearLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontWeight: '700', fontSize: 15 },
  // 4 columns x 3 rows for the 12 months — same filled-rounded-cell language
  // as AttendanceCalendarView's day grid (which uses 7 columns for weekdays).
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellWrap: { width: '25%', aspectRatio: 1.6, padding: 4 },
  calCell: { width: '100%', height: '100%', borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  calCellText: { fontSize: 12, fontWeight: '700' },
  calCellEmpty: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  calCellTextEmpty: { color: colors.mutedText },
  calCellPaid: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  calCellTextPaid: { color: colors.onSuccess },
  calCellPending: { backgroundColor: colors.error, borderColor: colors.onError },
  calCellTextPending: { color: colors.onError },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5 },
  legendText: { color: colors.onSurfaceTertiary, fontSize: 11 },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: colors.mutedText, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  actionBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, marginTop: spacing.lg,
  },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  secondaryBtn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  secondaryBtnText: { color: colors.mutedText, fontWeight: '700', fontSize: 13 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderColor: colors.brand, borderTopWidth: 1, padding: spacing.lg, paddingBottom: 36,
  },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
});
