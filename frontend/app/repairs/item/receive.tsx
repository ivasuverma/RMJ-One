import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; description: string; customer_name: string; karigar_name: string | null;
  karigar_id?: string | null;
  current_issue_weight: number | null; current_issue_fine_weight?: number | null; purity?: number;
};

type Mode = 'pick' | 'form';

function round3(n: number) { return Math.round(n * 1000) / 1000; }
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export default function ReceiveFromKarigarScreen() {
  const { itemId: routeItemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>(routeItemId ? 'form' : 'pick');
  const [item, setItem] = useState<Item | null>(null);
  const [pickList, setPickList] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [weight, setWeight] = useState('');
  const [processLoss, setProcessLoss] = useState('');
  const [note, setNote] = useState('');
  const [labourAmount, setLabourAmount] = useState('');
  const [payCash, setPayCash] = useState('');
  const [payMetalWeight, setPayMetalWeight] = useState('');
  const [payMetalValue, setPayMetalValue] = useState('');
  const [recvCash, setRecvCash] = useState('');
  const [recvMetalWeight, setRecvMetalWeight] = useState('');
  const [prevBalance, setPrevBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const loadBalance = useCallback(async (kid?: string | null) => {
    if (!kid) { setPrevBalance(0); return; }
    try {
      const res = await api.get<{ amount_due: number }>(`/karigars/${kid}/ledger`);
      setPrevBalance(res.amount_due || 0);
    } catch (_e) { setPrevBalance(0); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (routeItemId) {
        const res = await api.get<{ item: Item }>(`/repair-items/${routeItemId}`);
        setItem(res.item);
        setMode('form');
        loadBalance(res.item.karigar_id);
      } else {
        setPickList(await api.get<Item[]>('/repair-items?status=with_karigar'));
        setMode('pick');
      }
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [routeItemId, loadBalance]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickItem = (it: Item) => { setItem(it); setMode('form'); loadBalance(it.karigar_id); };

  const submit = async () => {
    if (submittingRef.current || !item) return;
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter the weight received back'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${item.id}/receive`, {
        weight: w, note,
        process_loss: parseFloat(processLoss) || 0,
        labour_amount: parseFloat(labourAmount) || 0,
        pay_cash: parseFloat(payCash) || 0,
        pay_metal_weight: parseFloat(payMetalWeight) || 0,
        pay_metal_value: parseFloat(payMetalValue) || 0,
        recv_cash: parseFloat(recvCash) || 0,
        recv_metal_weight: parseFloat(recvMetalWeight) || 0,
      });
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const onBack = () => {
    if (mode === 'form' && !routeItemId) { setItem(null); setMode('pick'); return; }
    router.back();
  };

  const headerTitle = mode === 'pick' ? 'Select Tag to Receive' : 'Receive from Karigar';

  if (loading && mode === 'form' && !item) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const purity = item?.purity ?? 100;
  const issuedWeight = item?.current_issue_weight || 0;
  const fineIssued = item?.current_issue_fine_weight ?? round3(issuedWeight * purity / 100);
  const lossNum = parseFloat(processLoss) || 0;
  const fineLoss = round3(lossNum * purity / 100);
  const weightNum = parseFloat(weight) || 0;
  const fineReceived = round3(weightNum * purity / 100);
  const balanceFine = weight ? round3(fineIssued - fineLoss - fineReceived) : null;

  const labourNum = parseFloat(labourAmount) || 0;
  const cashNum = parseFloat(payCash) || 0;
  const metalValueNum = parseFloat(payMetalValue) || 0;
  const recvCashNum = parseFloat(recvCash) || 0;
  const remainingDue = round3(prevBalance + labourNum - cashNum - metalValueNum - recvCashNum);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="receive-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      {mode === 'pick' ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.hint}>Pick a tag that's currently with a karigar.</Text>
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : pickList.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="hammer-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>Nothing is out with a karigar right now</Text>
            </View>
          ) : pickList.map((it) => (
            <Pressable key={it.id} onPress={() => pickItem(it)} style={styles.itemRow} testID={`pick-${it.id}`}>
              <View style={styles.iconBox}><Ionicons name="hammer-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{it.item_code} · {it.customer_name}</Text>
                <Text style={styles.cMeta}>{it.description}{it.karigar_name ? ` · with ${it.karigar_name}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </ScrollView>
      ) : item ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{item.item_code} · {item.customer_name}</Text>
              <Text style={styles.cMeta}>{item.description}{item.karigar_name ? ` · with ${item.karigar_name}` : ''}</Text>
            </View>

            <Text style={styles.label}>Weight received (g)</Text>
            <TextInput testID="receive-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Process loss (g) — filing, polishing, etc.</Text>
            <TextInput testID="process-loss" value={processLoss} onChangeText={(v) => setProcessLoss(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />

            <View style={styles.table} testID="weight-table">
              <View style={styles.tableHeadRow}>
                <Text style={[styles.tableCell, styles.tableHeadText, { flex: 1.4 }]}> </Text>
                <Text style={[styles.tableCell, styles.tableHeadText]}>Gross</Text>
                <Text style={[styles.tableCell, styles.tableHeadText]}>%</Text>
                <Text style={[styles.tableCell, styles.tableHeadText]}>Fine</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableRowLabel, { flex: 1.4 }]}>Issued</Text>
                <Text style={styles.tableCell}>{issuedWeight.toFixed(3)}</Text>
                <Text style={styles.tableCell}>{purity}%</Text>
                <Text style={styles.tableCell}>{fineIssued.toFixed(3)}</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableRowLabel, { flex: 1.4 }]}>Process Loss</Text>
                <Text style={styles.tableCell}>{lossNum.toFixed(3)}</Text>
                <Text style={styles.tableCell}>{purity}%</Text>
                <Text style={styles.tableCell}>{fineLoss.toFixed(3)}</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableRowLabel, { flex: 1.4 }]}>Received</Text>
                <Text style={styles.tableCell}>{weightNum.toFixed(3)}</Text>
                <Text style={styles.tableCell}>{purity}%</Text>
                <Text style={styles.tableCell}>{fineReceived.toFixed(3)}</Text>
              </View>
            </View>

            {balanceFine != null && (
              <View style={[styles.balancePreview, balanceFine > 0 && styles.balancePreviewNegative]} testID="receive-balance-preview">
                <Ionicons name={balanceFine <= 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={14} color={balanceFine <= 0 ? colors.onSuccess : colors.onError} />
                <Text style={[styles.balancePreviewText, { color: balanceFine <= 0 ? colors.onSuccess : colors.onError }]}>
                  {balanceFine > 0 ? `Karigar still owes ${balanceFine.toFixed(3)}g fine gold` : balanceFine < 0 ? `Excess returned: ${Math.abs(balanceFine).toFixed(3)}g fine gold` : 'Fully accounted for'}
                </Text>
              </View>
            )}

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="receive-note" value={note} onChangeText={setNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.sectionTitle}>Pay Karigar Now (optional)</Text>
            <Text style={styles.label}>Labour amount due (₹)</Text>
            <TextInput testID="labour-amount" value={labourAmount} onChangeText={(v) => setLabourAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Cash paid (₹)</Text>
                <TextInput testID="pay-cash" value={payCash} onChangeText={(v) => setPayCash(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Metal paid (g)</Text>
                <TextInput testID="pay-metal-weight" value={payMetalWeight} onChangeText={(v) => setPayMetalWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
            {!!parseFloat(payMetalWeight || '0') && (
              <>
                <Text style={styles.label}>Value of metal paid (₹)</Text>
                <TextInput testID="pay-metal-value" value={payMetalValue} onChangeText={(v) => setPayMetalValue(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </>
            )}

            <Text style={styles.sectionTitle}>Receive from Karigar (optional)</Text>
            <Text style={styles.hint}>If the karigar is settling a shortfall by handing over cash or extra metal.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Cash received (₹)</Text>
                <TextInput testID="recv-cash" value={recvCash} onChangeText={(v) => setRecvCash(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Metal received (g)</Text>
                <TextInput testID="recv-metal-weight" value={recvMetalWeight} onChangeText={(v) => setRecvMetalWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>

            {!!prevBalance && (
              <View style={styles.balanceRow} testID="prev-balance-row">
                <Text style={styles.balanceRowLabel}>Previous balance</Text>
                <Text style={[styles.balanceRowValue, prevBalance > 0 ? { color: colors.onWarning } : { color: colors.onSuccess }]}>{fmtINR(Math.abs(prevBalance))}{prevBalance < 0 ? ' cr' : ''}</Text>
              </View>
            )}

            {(labourNum > 0 || !!prevBalance) && (
              <View style={styles.totalRow} testID="remaining-due">
                <Text style={styles.totalLabel}>{remainingDue > 0 ? 'Remaining Due' : remainingDue < 0 ? 'Overpaid' : 'Fully Settled'}</Text>
                <Text style={[styles.totalValue, remainingDue > 0 && { color: colors.onError }, remainingDue <= 0 && { color: colors.onSuccess }]}>{fmtINR(Math.abs(remainingDue))}</Text>
              </View>
            )}

            <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="receive-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Receive</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
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

  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },

  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },

  table: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.md, overflow: 'hidden',
  },
  tableHeadRow: { flexDirection: 'row', backgroundColor: colors.surfaceTertiary, paddingVertical: 8, paddingHorizontal: spacing.sm },
  tableHeadText: { color: colors.brandSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  tableCell: { flex: 1, color: colors.onSurface, fontSize: 12, textAlign: 'left' },
  tableRowLabel: { color: colors.onSurfaceSecondary, fontWeight: '600' },

  balancePreview: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.success,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: spacing.sm,
  },
  balancePreviewNegative: { backgroundColor: colors.error },
  balancePreviewText: { fontSize: 12, fontWeight: '700', flex: 1 },

  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700', marginTop: spacing.lg, marginBottom: 4, fontFamily: fonts.display },

  balanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xs, paddingVertical: 6, marginTop: spacing.sm,
  },
  balanceRowLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  balanceRowValue: { fontSize: 13, fontWeight: '700' },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.md,
  },
  totalLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  totalValue: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
