import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type InterestMonth = { period: string; date: string; amount: number; paid: boolean; projected?: boolean };
type Loan = {
  interest_months: InterestMonth[];
  principal_balance?: number; interest_rate_percent?: number; loan_date?: string;
};

const addMonth = (y: number, m: number): [number, number] => (m === 12 ? [y + 1, 1] : [y, m + 1]);

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Split out of the loan detail screen so that screen stays summary-only —
// this is the "transact" affordance it links to for recording a cash
// payment against a gold loan (interest or principal, staff picks which).
// For interest, staff can tap the specific pending month(s) this payment
// covers on the same calendar the loan summary shows — that tags the
// payment to those exact periods (see _compute_loan_state in
// gold_loans.py) instead of leaving it to guess via FIFO matching.
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
  const [type, setType] = useState<'interest' | 'principal'>(typeParam === 'principal' ? 'principal' : 'interest');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [pendingMonths, setPendingMonths] = useState<InterestMonth[]>([]);
  const [futureMonths, setFutureMonths] = useState<InterestMonth[]>([]);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selected, setSelected] = useState<string[]>(periodsParam ? periodsParam.split(',').filter(Boolean) : []);

  useEffect(() => {
    api.get<Loan>(`/gold-loans/${id}`).then((loan) => {
      const pending = loan.interest_months.filter((m) => !m.paid);
      setPendingMonths(pending);

      // Months not yet due can still be recorded against (advance/prepaid
      // interest) — project them forward from the last known period (or
      // from the loan's own start period, using the same 1-15 cutoff the
      // backend uses) at the current outstanding balance and rate. Once
      // the real due entry posts on schedule, it'll match this period tag
      // and show as paid — see _compute_loan_state in gold_loans.py.
      const rate = loan.interest_rate_percent || 0;
      const bal = loan.principal_balance || 0;
      const projAmount = Math.round(bal * rate / 100);
      const future: InterestMonth[] = [];
      if (projAmount > 0) {
        let ay: number; let am: number;
        if (loan.interest_months.length > 0) {
          const maxPeriod = loan.interest_months.reduce((mx, mo) => (mo.period > mx ? mo.period : mx), loan.interest_months[0].period);
          ay = parseInt(maxPeriod.slice(0, 4), 10); am = parseInt(maxPeriod.slice(5, 7), 10);
          [ay, am] = addMonth(ay, am);
        } else if (loan.loan_date) {
          const ld = new Date(`${loan.loan_date}T00:00:00`);
          ay = ld.getFullYear(); am = ld.getMonth() + 1;
          if (ld.getDate() > 15) [ay, am] = addMonth(ay, am);
        } else {
          const now = new Date(); ay = now.getFullYear(); am = now.getMonth() + 1;
        }
        let y = ay; let m = am;
        for (let i = 0; i < 24; i += 1) {
          future.push({ period: `${y}-${String(m).padStart(2, '0')}`, date: '', amount: projAmount, paid: false, projected: true });
          [y, m] = addMonth(y, m);
        }
      }
      setFutureMonths(future);

      const combined = [...pending, ...future];
      const withData = (periodsParam ? combined.filter((m) => selected.includes(m.period)) : pending);
      if (withData.length > 0) setCalYear(parseInt(withData[withData.length - 1].period.slice(0, 4), 10));
    }).catch(() => { /* month picker just won't show anything — amount entry still works */ });
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

  const monthsByNum: Record<string, InterestMonth> = {};
  allMonths.forEach((m) => { if (parseInt(m.period.slice(0, 4), 10) === calYear) monthsByNum[m.period.slice(5, 7)] = m; });

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { notify('Missing', 'Enter an amount greater than 0'); return; }
    setSaving(true);
    try {
      const body: any = { amount: amt, type, note: note.trim() };
      if (type === 'interest' && selected.length > 0) body.periods = selected;
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
        <Text style={styles.title}>Record Payment</Text>
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
          </View>

          {type === 'interest' && allMonths.length > 0 && (
            <View style={styles.calCard} testID="pay-month-picker">
              <Text style={styles.calHeader}>Which month(s) is this for?</Text>
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
              <View style={styles.calYearRow}>
                <Pressable onPress={() => setCalYear((y) => y - 1)} style={styles.calYearNav} testID="pay-cal-prev-year">
                  <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
                </Pressable>
                <Text style={styles.calYearLabel}>{calYear}</Text>
                <Pressable onPress={() => setCalYear((y) => y + 1)} style={styles.calYearNav} testID="pay-cal-next-year">
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
                </Pressable>
              </View>
              <View style={styles.calGrid}>
                {MONTHS.map((lbl, i) => {
                  const mm = String(i + 1).padStart(2, '0');
                  const m = monthsByNum[mm];
                  const isSelected = m && selected.includes(m.period);
                  const cellStyle = !m ? styles.calCellEmpty : isSelected ? styles.calCellSelected : m.projected ? styles.calCellFuture : styles.calCellPending;
                  const textStyle = !m ? styles.calCellTextEmpty : isSelected ? styles.calCellTextSelected : m.projected ? styles.calCellTextFuture : styles.calCellTextPending;
                  return (
                    <Pressable key={mm} style={styles.calCellWrap} onPress={() => m && toggleMonth(m)} disabled={!m} testID={`pay-cal-${calYear}-${mm}`}>
                      <View style={[styles.calCell, cellStyle]}>
                        <Text style={[styles.calCellText, textStyle]}>{lbl}</Text>
                        {!!m && <Text style={[styles.calCellAmount, textStyle]}>{fmtINR(m.amount)}</Text>}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {selected.length > 0 && (
                <Text style={styles.calSelectedText}>{selected.length} month{selected.length === 1 ? '' : 's'} selected · {fmtINR(allMonths.filter((m) => selected.includes(m.period)).reduce((s, m) => s + m.amount, 0))}</Text>
              )}
            </View>
          )}

          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput testID="pay-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="pay-note" value={note} onChangeText={setNote} placeholderTextColor={colors.mutedText} style={styles.input} />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-payment-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>Record Payment</Text>}
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
  calYearRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  calYearNav: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  calYearLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontWeight: '700', fontSize: 15 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellWrap: { width: '25%', aspectRatio: 1.3, padding: 4 },
  calCell: { width: '100%', height: '100%', borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  calCellText: { fontSize: 12, fontWeight: '700' },
  calCellAmount: { fontSize: 9, fontWeight: '600', marginTop: 1 },
  calCellEmpty: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  calCellTextEmpty: { color: colors.mutedText },
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
