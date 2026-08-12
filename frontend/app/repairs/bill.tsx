import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: 'received' | 'with_karigar' | 'ready' | 'delivered';
  labour_charge: number; customer_adjustment?: number;
  fine_weight_diff?: number | null; weight_diff?: number | null;
  billed_amount: number | null; payment_mode: string | null; delivered_at?: string;
};

type Mode = 'list' | 'pick' | 'form';

export default function RepairBillScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>('list');
  const [bills, setBills] = useState<Item[]>([]);
  const [readyItems, setReadyItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  // Bill form fields
  const [billLabour, setBillLabour] = useState('');
  const [billMaterial, setBillMaterial] = useState('');
  const [billExtra, setBillExtra] = useState('');
  const [billExtraNote, setBillExtraNote] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [weightRate, setWeightRate] = useState('');
  const [prevBalance, setPrevBalance] = useState('');

  const loadBills = useCallback(async () => {
    try { setBills(await api.get<Item[]>('/repair-items?status=delivered')); }
    catch (_e) { setBills([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (mode === 'list') loadBills(); }, [loadBills, mode]));

  const openPicker = async () => {
    setMode('pick');
    setLoading(true);
    try { setReadyItems(await api.get<Item[]>('/repair-items?status=ready')); }
    catch (_e) { setReadyItems([]); }
    finally { setLoading(false); }
  };

  const pickItem = (item: Item) => {
    setPicked(item);
    setBillLabour(String(item.labour_charge || 0));
    setBillMaterial(String(item.customer_adjustment || 0));
    setBillExtra(''); setBillExtraNote(''); setPaymentMode('cash'); setWeightRate(''); setPrevBalance('');
    setMode('form');
  };

  const fineWeightChange = picked?.fine_weight_diff || 0;
  const rateNum = parseFloat(weightRate) || 0;
  const weightCharge = Math.round(fineWeightChange * rateNum * 100) / 100;

  const applyWeightCharge = () => setBillMaterial(String(weightCharge));

  const prevBalanceNum = parseFloat(prevBalance) || 0;
  const billTotal = prevBalanceNum + (parseFloat(billLabour) || 0) + (parseFloat(billMaterial) || 0) + (parseFloat(billExtra) || 0);

  const createBill = async () => {
    if (submittingRef.current || !picked) return;
    if (billTotal <= 0) { Alert.alert('Invalid', 'The billed total must be greater than 0'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${picked.id}/deliver`, {
        labour_charge: parseFloat(billLabour) || 0, material_adjustment: parseFloat(billMaterial) || 0,
        extra_charges: parseFloat(billExtra) || 0, extra_charges_note: billExtraNote,
        previous_balance: prevBalanceNum,
        payment_mode: paymentMode, note: '',
      });
      setPicked(null); setMode('list'); setLoading(true);
      await loadBills();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const confirmDeleteBill = (item: Item) => {
    confirmAction(
      'Delete bill?',
      `This undoes the bill for ${item.item_code} (₹${(item.billed_amount || 0).toFixed(0)}) and puts the tag back to Pending to Bill. This cannot be undone.`,
      'Delete',
      () => doDeleteBill(item),
    );
  };

  const doDeleteBill = async (item: Item) => {
    setDeletingId(item.id);
    try {
      await api.del(`/repair-items/${item.id}/bill`);
      await loadBills();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setDeletingId(''); }
  };

  const printBill = async (item: Item) => {
    setPrintingId(item.id);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/repair-items/${item.id}/bill/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Bill failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Ready', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrintingId(''); }
  };

  const headerTitle = mode === 'list' ? 'Repair Bills' : mode === 'pick' ? 'Select Item to Bill' : 'Create Bill';
  const onBack = () => {
    if (mode === 'form') { setMode('pick'); return; }
    if (mode === 'pick') { setMode('list'); return; }
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-bill-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{headerTitle}</Text>
        {mode === 'list' ? (
          <Pressable onPress={openPicker} style={[styles.iconBtn, styles.addBtn]} testID="new-bill-btn" hitSlop={12}>
            <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      {mode === 'list' && (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBills(); }} tintColor={colors.brandPrimary} />}
        >
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : bills.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>No bills yet — tap + to bill a ready item</Text>
            </View>
          ) : bills.map((b) => (
            <View key={b.id} style={styles.itemRow} testID={`bill-${b.id}`}>
              <View style={styles.iconBox}><Ionicons name="receipt-outline" size={18} color={colors.brandSecondary} /></View>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/repairs/item/${b.id}` as any)}>
                <Text style={styles.cName}>{b.item_code} · {b.customer_name}</Text>
                <Text style={styles.cMeta}>
                  {b.description}{b.billed_amount != null ? ` · ₹${b.billed_amount.toFixed(0)}` : ''}{b.payment_mode ? ` · ${b.payment_mode}` : ''}{b.delivered_at ? ` · ${b.delivered_at.slice(0, 10)}` : ''}
                </Text>
              </Pressable>
              <Pressable onPress={() => printBill(b)} disabled={printingId === b.id} style={styles.printBtn} testID={`print-bill-${b.id}`}>
                {printingId === b.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} />}
              </Pressable>
              <Pressable onPress={() => confirmDeleteBill(b)} disabled={deletingId === b.id} style={styles.deleteBtn} testID={`delete-bill-${b.id}`}>
                {deletingId === b.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {mode === 'pick' && (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.hint}>Pick an item that's pending to bill.</Text>
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : readyItems.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>Nothing is pending to bill right now</Text>
            </View>
          ) : readyItems.map((it) => (
            <Pressable key={it.id} onPress={() => pickItem(it)} style={styles.itemRow} testID={`pick-${it.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{it.item_code} · {it.customer_name}</Text>
                <Text style={styles.cMeta}>{it.description} · Labour ₹{it.labour_charge.toFixed(0)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {mode === 'form' && picked && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{picked.item_code} · {picked.customer_name}</Text>
              <Text style={styles.cMeta}>{picked.description}</Text>
            </View>

            <Text style={styles.label}>Previous Balance, if any (₹)</Text>
            <TextInput testID="bill-prev-balance" value={prevBalance} onChangeText={(v) => setPrevBalance(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Labour Charge (₹)</Text>
            <TextInput testID="bill-labour" value={billLabour} onChangeText={(v) => setBillLabour(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

            {!!fineWeightChange && (
              <View style={styles.weightChangeCard} testID="weight-change-card">
                <View style={styles.weightChangeRow}>
                  <Ionicons name={fineWeightChange >= 0 ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={fineWeightChange >= 0 ? colors.onWarning : colors.onSuccess} />
                  <Text style={styles.weightChangeText}>Weight change from karigar: {fineWeightChange >= 0 ? '+' : ''}{fineWeightChange.toFixed(3)}g fine</Text>
                </View>
                <Text style={styles.label}>Rate (₹ / gram)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput testID="weight-rate" value={weightRate} onChangeText={(v) => setWeightRate(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} />
                  <Pressable onPress={applyWeightCharge} disabled={!rateNum} style={[styles.applyBtn, !rateNum && { opacity: 0.5 }]} testID="apply-weight-charge">
                    <Text style={styles.applyBtnText}>Apply ₹{weightCharge.toFixed(0)}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Text style={styles.label}>Material / Wastage Adjustment (₹)</Text>
            <TextInput testID="bill-material" value={billMaterial} onChangeText={(v) => setBillMaterial(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Text style={styles.label}>Extra Charges (₹)</Text>
            <TextInput testID="bill-extra" value={billExtra} onChangeText={(v) => setBillExtra(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
            {(parseFloat(billExtra) || 0) > 0 && (
              <TextInput testID="bill-extra-note" value={billExtraNote} onChangeText={setBillExtraNote} placeholder="What's this extra charge for?" placeholderTextColor={colors.mutedText} style={styles.input} />
            )}

            <View style={styles.totalRow} testID="bill-total">
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>₹{billTotal.toFixed(0)}</Text>
            </View>

            <Text style={styles.label}>Payment mode</Text>
            <View style={styles.chipRow}>
              {(['cash', 'upi', 'card'] as const).map((m) => (
                <Pressable key={m} onPress={() => setPaymentMode(m)} style={[styles.chip, paymentMode === m && styles.chipActive]} testID={`payment-${m}`}>
                  <Text style={[styles.chipText, paymentMode === m && styles.chipTextActive]}>{m.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={createBill} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="create-bill-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Create Bill</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
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
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  printBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
  },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error,
  },

  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  weightChangeCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  weightChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  weightChangeText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  applyBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  totalLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  totalValue: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
