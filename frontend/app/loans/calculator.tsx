import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const COMMON_PURITIES = [
  { label: '24K (99.9%)', value: '99.9' },
  { label: '22K (91.6%)', value: '91.6' },
  { label: '18K (75%)', value: '75' },
  { label: '14K (58.5%)', value: '58.5' },
];

const num = (s: string) => parseFloat(s) || 0;
const fmtINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// A quick, throwaway scratch-pad — nothing here is saved. Lets staff work
// out, on the spot, what a piece of gold is actually worth (gross weight
// minus stones/beads, times purity, times today's rate) and how that
// compares against an amount already in mind (a loan amount, a redemption
// figure, an exchange value) — the difference is what still needs to
// change hands either way.
export default function GoldValueCalculatorScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Opened from a loan's detail screen (see the calculator button there),
  // gross weight and current total outstanding arrive pre-filled so staff
  // don't have to re-key numbers the app already knows — everything else
  // (deductions, purity, rate) is still theirs to fill in/adjust, and
  // reset() returns to these starting values rather than wiping them, so
  // it stays useful as "start over" in that context instead of "start blank".
  // principal/interestDue/interestPaid are read-only facts about the loan —
  // shown in the Summary card, never edited here.
  const {
    grossWeight: grossWeightParam, receivable: receivableParam, loanNo,
    principal: principalParam, interestDue: interestDueParam, interestPaid: interestPaidParam,
  } = useLocalSearchParams<{
    grossWeight?: string; receivable?: string; loanNo?: string;
    principal?: string; interestDue?: string; interestPaid?: string;
  }>();
  const initialGrossWeight = grossWeightParam ? String(parseFloat(grossWeightParam)) : '';
  const initialReceivable = receivableParam ? String(Math.round(parseFloat(receivableParam))) : '';
  const totalOutstanding = receivableParam ? parseFloat(receivableParam) : 0;
  const totalLent = principalParam ? parseFloat(principalParam) : 0;
  const totalInterest = interestDueParam ? parseFloat(interestDueParam) : 0;
  const paidInterest = interestPaidParam ? parseFloat(interestPaidParam) : 0;

  const [grossWeight, setGrossWeight] = useState(initialGrossWeight);
  const [deductWeight, setDeductWeight] = useState('');
  const [purity, setPurity] = useState('91.6');
  const [rate, setRate] = useState('');
  const [receivable, setReceivable] = useState(initialReceivable);

  useEffect(() => {
    api.get<any>('/settings/gold-rate')
      .then((g) => { const r = g?.today?.gold_rate; if (r) setRate(String(r)); })
      .catch(() => { /* rate just starts blank — still fully editable */ });
  }, []);

  const netWeight = Math.max(num(grossWeight) - num(deductWeight), 0);
  const goldValue = netWeight * (num(purity) / 100) * num(rate);
  const balance = num(receivable) - goldValue;

  const reset = () => { setGrossWeight(initialGrossWeight); setDeductWeight(''); setReceivable(initialReceivable); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="gold-calculator-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Gold Value Calculator</Text>
        <Pressable onPress={reset} style={styles.iconBtn} testID="calc-reset-btn" hitSlop={12}>
          <Ionicons name="refresh" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {!!loanNo && (
            <Text style={styles.prefillNote} testID="calc-prefill-note">Weight and receivable pre-filled from {loanNo} — adjust anything before it's final.</Text>
          )}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Weight</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Gross weight (g)</Text>
                <TextInput testID="calc-gross" value={grossWeight} onChangeText={(v) => setGrossWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Stones / beads (g)</Text>
                <TextInput testID="calc-deduct" value={deductWeight} onChangeText={(v) => setDeductWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Net weight</Text>
              <Text style={styles.resultValue}>{netWeight.toFixed(3)}g</Text>
            </View>
            <Text style={styles.formula}>Gross weight − stones/beads = net weight</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Value</Text>
            <Text style={styles.label}>Purity</Text>
            <View style={styles.chipRow}>
              {COMMON_PURITIES.map((p) => (
                <Pressable key={p.value} onPress={() => setPurity(p.value)} style={[styles.chip, purity === p.value && styles.chipSelected]} testID={`calc-purity-${p.value}`}>
                  <Text style={[styles.chipText, purity === p.value && styles.chipTextSelected]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Purity %</Text>
                <TextInput testID="calc-purity-custom" value={purity} onChangeText={(v) => setPurity(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="Purity %" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Rate (₹ / gram)</Text>
                <TextInput testID="calc-rate" value={rate} onChangeText={(v) => setRate(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Gold value</Text>
              <Text style={styles.resultValue}>{fmtINR(goldValue)}</Text>
            </View>
            <Text style={styles.formula}>Net weight × purity × rate = gold value</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Balance</Text>
            <Text style={styles.label}>Total receivable / amount in mind (₹)</Text>
            <TextInput testID="calc-receivable" value={receivable} onChangeText={(v) => setReceivable(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Balance</Text>
              <Text style={[styles.resultValue, { color: balance > 0 ? colors.onWarning : balance < 0 ? colors.onError : colors.onSuccess }]}>
                {fmtINR(Math.abs(balance))}
              </Text>
            </View>
            <Text style={[styles.balanceTag, { color: balance > 0 ? colors.onWarning : balance < 0 ? colors.onError : colors.onSuccess }]}>
              {balance > 0 ? 'Receivable from customer' : balance < 0 ? 'Payable to customer' : 'Settled — no balance either way'}
            </Text>
            <Text style={styles.formula}>Total receivable − gold value = balance</Text>
          </View>

          {!!loanNo && (
            <View style={styles.card} testID="calc-summary-card">
              <Text style={styles.cardTitle}>Summary</Text>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total lent</Text><Text style={styles.summaryValue}>{fmtINR(totalLent)}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Total interest</Text><Text style={styles.summaryValue}>+ {fmtINR(totalInterest)}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Paid interest</Text><Text style={styles.summaryValue}>− {fmtINR(paidInterest)}</Text></View>
              <View style={[styles.summaryRow, { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
                <Text style={styles.summaryLabelTotal}>Outstanding</Text>
                <Text style={styles.summaryValueTotal}>{fmtINR(totalOutstanding)}</Text>
              </View>
              <View style={[styles.summaryRow, { marginTop: spacing.sm }]}>
                <Text style={styles.summaryLabel}>Value of gold</Text><Text style={styles.summaryValue}>− {fmtINR(goldValue)}</Text>
              </View>
              <View style={[styles.summaryRow, { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }]}>
                <Text style={styles.summaryLabelTotal}>{balance > 0 ? 'Total receivable' : balance < 0 ? 'Total payable' : 'Settled'}</Text>
                <Text style={[styles.summaryValueTotal, { color: balance > 0 ? colors.onWarning : balance < 0 ? colors.onError : colors.onSuccess }]}>
                  {fmtINR(Math.abs(balance))}
                </Text>
              </View>
              <Text style={styles.formula}>Total lent + total interest − paid interest = outstanding. Outstanding (or your adjusted receivable above) − value of gold = total receivable/payable.</Text>
            </View>
          )}
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
  prefillNote: { color: colors.onSurfaceTertiary, fontSize: 12, marginBottom: spacing.md },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  summaryValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  summaryLabelTotal: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  summaryValueTotal: { color: colors.brandSecondary, fontSize: 16, fontWeight: '800' },
  input: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.onBrandPrimary },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  resultLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  resultValue: { color: colors.brandSecondary, fontSize: 17, fontWeight: '800' },
  balanceTag: { fontSize: 12, fontWeight: '700', marginTop: 4, textAlign: 'right' },
  formula: { color: colors.mutedText, fontSize: 11, marginTop: 4 },
});
