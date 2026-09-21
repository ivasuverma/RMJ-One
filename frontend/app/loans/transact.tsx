import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { DateField } from '@/src/components/DateField';
import { todayIST, localDateStr } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// A "month" here is really a 30-day interest period (loan_date + 30, +60,
// ... — see gold_loans.py) — `period` is the period's own start date and
// `date` is its due date (last day of the period), not a calendar month.
type InterestMonth = { period: string; date: string; amount: number; paid: boolean; projected?: boolean };
type Loan = {
  interest_months: InterestMonth[];
  principal_balance?: number; interest_rate_percent?: number; loan_date?: string;
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso: string) => { const [, m, d] = iso.split('-'); return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`; };

// Split out of the loan detail screen so that screen stays summary-only —
// this is the "transact" affordance it links to for recording cash moving
// either direction on a gold loan: in from the customer (interest or
// principal/redemption, staff picks which) or out to the customer
// (top-up, more cash against the same pledge). For interest, staff can tap
// the specific pending month(s) this payment covers on the same calendar
// the loan summary shows — that tags the payment to those exact periods
// (see _compute_loan_state in gold_loans.py) instead of leaving it to
// guess via FIFO matching.
export default function GoldLoanTransactScreen() {
  const { id, type: typeParam, amount: amountParam, periods: periodsParam } = useLocalSearchParams<{
    id: string; type?: string; amount?: string; periods?: string;
  }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Pre-filled when arriving from a shortcut (e.g. the "Record Interest"
  // button on an overdue loan's list tile, which already knows the exact
  // pending amount, or a specific month tapped on the loan's own interest
  // calendar) — still just a starting point, staff can adjust before saving.
  const [amount, setAmount] = useState(amountParam ? String(Math.round(parseFloat(amountParam))) : '');
  const [type, setType] = useState<'interest' | 'principal' | 'topup'>(
    typeParam === 'principal' ? 'principal' : typeParam === 'topup' ? 'topup' : 'interest',
  );
  const [note, setNote] = useState('');
  // Principal repayments and top-ups feed the day-wise interest calculation
  // directly (see _month_interest_daywise in gold_loans.py) — the exact
  // date matters, so staff can backdate to when the cash actually changed
  // hands instead of it silently defaulting to today. Not needed for
  // interest: that's tagged to a period via the month calendar below, not a
  // single date, and doesn't feed the balance math.
  const [txnDate, setTxnDate] = useState(todayIST());
  const [saving, setSaving] = useState(false);

  const [pendingMonths, setPendingMonths] = useState<InterestMonth[]>([]);
  const [futureMonths, setFutureMonths] = useState<InterestMonth[]>([]);
  const [selected, setSelected] = useState<string[]>(periodsParam ? periodsParam.split(',').filter(Boolean) : []);

  useEffect(() => {
    api.get<Loan>(`/gold-loans/${id}`).then((loan) => {
      const pending = loan.interest_months.filter((m) => !m.paid);
      setPendingMonths(pending);

      // Periods not yet due can still be recorded against (advance/prepaid
      // interest) — project them forward from the last known period's end
      // (or from the loan's own start date — day-wise proration on the
      // backend means even a loan's first period already has its own due
      // entry) at the current outstanding balance and rate, each a full
      // 30-day block (daily rate = monthly rate / 30, so every projected
      // period is worth exactly one month's interest). Once the real due
      // entry posts on schedule, it'll match this period tag and show as
      // paid — see _month_interest_daywise in gold_loans.py.
      const rate = loan.interest_rate_percent || 0;
      const bal = loan.principal_balance || 0;
      const dailyRate = rate / 100 / 30;
      const future: InterestMonth[] = [];
      if (bal > 0 && dailyRate > 0) {
        let start: Date;
        if (loan.interest_months.length > 0) {
          const maxEntry = loan.interest_months.reduce((mx, mo) => (mo.period > mx.period ? mo : mx), loan.interest_months[0]);
          start = new Date(`${maxEntry.date}T00:00:00`);
          start.setDate(start.getDate() + 1);
        } else if (loan.loan_date) {
          start = new Date(`${loan.loan_date}T00:00:00`);
        } else {
          start = new Date();
        }
        const projAmount = Math.round(bal * dailyRate * 30);
        for (let i = 0; i < 24; i += 1) {
          const periodStart = localDateStr(start);
          const end = new Date(start); end.setDate(end.getDate() + 29);
          future.push({ period: periodStart, date: localDateStr(end), amount: projAmount, paid: false, projected: true });
          start.setDate(start.getDate() + 30);
        }
      }
      setFutureMonths(future);
    }).catch(() => { /* period picker just won't show anything — amount entry still works */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const allMonths = [...pendingMonths, ...futureMonths];

  const toggleMonth = (m: InterestMonth) => {
    setSelected((prev) => {
      const next = prev.includes(m.period) ? prev.filter((p) => p !== m.period) : [...prev, m.period];
      const sum = allMonths.filter((pm) => next.includes(pm.period)).reduce((s, pm) => s + pm.amount, 0);
      if (next.length > 0) setAmount(String(Math.round(sum)));
      return next;
    });
  };


  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { notify('Missing', 'Enter an amount greater than 0'); return; }
    if (type !== 'interest' && !txnDate) { notify('Missing', 'Pick the date this happened'); return; }
    setSaving(true);
    try {
      const body: any = { amount: amt, type, note: note.trim() };
      if (type === 'interest' && selected.length > 0) body.periods = selected;
      if (type !== 'interest') body.date = txnDate;
      await api.post(`/gold-loans/${id}/payment`, body);
      router.back();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-transact-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{type === 'topup' ? 'Pay Customer More' : 'Record Payment'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Payment against</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => { setType('interest'); }} style={[styles.chip, type === 'interest' && styles.chipActive]} testID="pay-type-interest">
              <Text style={[styles.chipText, type === 'interest' && styles.chipTextActive]}>Interest</Text>
            </Pressable>
            <Pressable onPress={() => { setType('principal'); setSelected([]); }} style={[styles.chip, type === 'principal' && styles.chipActive]} testID="pay-type-principal">
              <Text style={[styles.chipText, type === 'principal' && styles.chipTextActive]}>Principal / Redemption</Text>
            </Pressable>
            <Pressable onPress={() => { setType('topup'); setSelected([]); }} style={[styles.chip, type === 'topup' && styles.chipActive]} testID="pay-type-topup">
              <Text style={[styles.chipText, type === 'topup' && styles.chipTextActive]}>Top-up</Text>
            </Pressable>
          </View>

          {type === 'topup' && (
            <Text style={styles.helperText}>
              Extra cash paid out to the customer against this same pledge — raises the outstanding principal, and
              next month's interest is charged on the higher balance.
            </Text>
          )}

          {type === 'interest' && allMonths.length > 0 && (
            <View style={styles.calCard} testID="pay-month-picker">
              <Text style={styles.calHeader}>Which period(s) is this for?</Text>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.onError }]} />
                  <Text style={styles.legendText}>Due</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.onInfo }]} />
                  <Text style={styles.legendText}>Future (advance)</Text>
                </View>
              </View>
              <View style={styles.periodPickList}>
                {allMonths.map((m, i) => {
                  const isSelected = selected.includes(m.period);
                  const rowStyle = isSelected ? styles.calCellSelected : m.projected ? styles.calCellFuture : styles.calCellPending;
                  const textStyle = isSelected ? styles.calCellTextSelected : m.projected ? styles.calCellTextFuture : styles.calCellTextPending;
                  return (
                    <Pressable
                      key={m.period} onPress={() => toggleMonth(m)}
                      style={[styles.periodPickRow, i === 0 && { borderTopWidth: 0 }, rowStyle]} testID={`pay-period-${m.period}`}
                    >
                      <Text style={[styles.periodPickRange, textStyle]}>{fmtDay(m.period)} – {fmtDay(m.date)}</Text>
                      <Text style={[styles.periodPickAmount, textStyle]}>{fmtINR(m.amount)}</Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={16} color={textStyle.color} />}
                    </Pressable>
                  );
                })}
              </View>
              {selected.length > 0 && (
                <Text style={styles.calSelectedText}>{selected.length} period{selected.length === 1 ? '' : 's'} selected · {fmtINR(allMonths.filter((m) => selected.includes(m.period)).reduce((s, m) => s + m.amount, 0))}</Text>
              )}
            </View>
          )}

          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput testID="pay-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

          {type !== 'interest' && (
            <>
              <DateField label="Date this happened" value={txnDate} onChange={setTxnDate} testID="pay-date" />
              <Text style={styles.helperText}>
                {type === 'topup'
                  ? 'This is when the balance actually goes up — interest from this date is charged on the higher amount.'
                  : 'This is when the balance actually goes down — interest from this date is charged on the lower amount.'}
              </Text>
            </>
          )}

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="pay-note" value={note} onChangeText={setNote} placeholderTextColor={colors.mutedText} style={styles.input} />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-payment-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>{type === 'topup' ? 'Pay Customer' : 'Record Payment'}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  helperText: { color: colors.onWarning, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  calCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  calHeader: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  periodPickList: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary, marginTop: spacing.sm, overflow: 'hidden',
  },
  periodPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  periodPickRange: { flex: 1, fontSize: 12.5, fontWeight: '600' },
  periodPickAmount: { fontSize: 12.5, fontWeight: '700' },
  calCellPending: { backgroundColor: colors.error, borderColor: colors.onError },
  calCellTextPending: { color: colors.onError },
  calCellFuture: { backgroundColor: colors.info, borderColor: colors.onInfo },
  calCellTextFuture: { color: colors.onInfo },
  calCellSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  calCellTextSelected: { color: colors.onBrandPrimary },
  calSelectedText: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, textAlign: 'center' },
  legendRow: { flexDirection: 'row', gap: spacing.md, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.mutedText, fontSize: 10 },

  submitBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, marginTop: spacing.xl,
  },
  submitBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
