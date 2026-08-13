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

type Mode = 'pick' | 'form' | 'bulk';
type BulkRow = { weight: string; wastageWeight: string };

function round3(n: number) { return Math.round(n * 1000) / 1000; }
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export default function ReceiveFromKarigarScreen() {
  const { itemId: routeItemId, itemIds: routeItemIds } = useLocalSearchParams<{ itemId: string; itemIds?: string }>();
  const bulkIds = useMemo(() => (routeItemIds ? routeItemIds.split(',').filter(Boolean) : []), [routeItemIds]);
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>(bulkIds.length > 0 ? 'bulk' : routeItemId ? 'form' : 'pick');
  const [item, setItem] = useState<Item | null>(null);
  const [bulkItems, setBulkItems] = useState<Item[]>([]);
  const [bulkRows, setBulkRows] = useState<Record<string, BulkRow>>({});
  const [pickList, setPickList] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [weight, setWeight] = useState('');
  const [wastageWeight, setWastageWeight] = useState('');
  const [processLoss, setProcessLoss] = useState('');
  const [note, setNote] = useState('');
  const [labourAmount, setLabourAmount] = useState('');
  const [payCash, setPayCash] = useState('');
  const [payMetalWeight, setPayMetalWeight] = useState('');
  const [payMetalValue, setPayMetalValue] = useState('');
  const [recvCash, setRecvCash] = useState('');
  const [recvMetalWeight, setRecvMetalWeight] = useState('');
  const [prevBalance, setPrevBalance] = useState(0);
  const [prevFineBalance, setPrevFineBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const loadBalance = useCallback(async (kid?: string | null) => {
    if (!kid) { setPrevBalance(0); setPrevFineBalance(0); return; }
    try {
      const res = await api.get<{ amount_due: number; fine_weight_balance: number }>(`/karigars/${kid}/ledger`);
      setPrevBalance(res.amount_due || 0);
      setPrevFineBalance(res.fine_weight_balance || 0);
    } catch (_e) { setPrevBalance(0); setPrevFineBalance(0); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (bulkIds.length > 0) {
        const results = await Promise.all(bulkIds.map((bid) => api.get<{ item: Item }>(`/repair-items/${bid}`).then((r) => r.item).catch(() => null)));
        const found = results.filter((x): x is Item => !!x);
        setBulkItems(found);
        setBulkRows((prev) => {
          const next = { ...prev };
          for (const it of found) if (!next[it.id]) next[it.id] = { weight: '', wastageWeight: '' };
          return next;
        });
        setMode('bulk');
      } else if (routeItemId) {
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
  }, [routeItemId, loadBalance, bulkIds]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetFormFields = () => {
    setWeight(''); setWastageWeight(''); setProcessLoss(''); setNote('');
    setLabourAmount(''); setPayCash(''); setPayMetalWeight(''); setPayMetalValue('');
    setRecvCash(''); setRecvMetalWeight(''); setPrevBalance(0); setPrevFineBalance(0);
  };

  const pickItem = (it: Item) => { resetFormFields(); setItem(it); setMode('form'); loadBalance(it.karigar_id); };

  const setBulkRow = (itemId: string, patch: Partial<BulkRow>) => {
    setBulkRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  const submitBulk = async () => {
    if (submittingRef.current || bulkItems.length === 0) return;
    const rows = bulkItems.map((it) => ({ it, row: bulkRows[it.id] || { weight: '', wastageWeight: '' } }));
    const missing = rows.filter(({ row }) => !parseFloat(row.weight));
    if (missing.length > 0) { Alert.alert('Missing', `Enter the weight received for: ${missing.map((m) => m.it.item_code).join(', ')}`); return; }
    submittingRef.current = true; setBusy(true);
    let okCount = 0;
    const failed: string[] = [];
    for (const { it, row } of rows) {
      try {
        await api.post(`/repair-items/${it.id}/receive`, {
          weight: parseFloat(row.weight) || 0, wastage_weight: parseFloat(row.wastageWeight) || 0, note: '',
        });
        okCount += 1;
      } catch (_e) { failed.push(it.item_code); }
    }
    setBusy(false); submittingRef.current = false;
    if (failed.length === 0) {
      Alert.alert('Done', `Received ${okCount} tag${okCount === 1 ? '' : 's'} back`);
      router.back();
    } else {
      Alert.alert('Partial success', `Received ${okCount} tag(s). Failed: ${failed.join(', ')}`);
      await load();
    }
  };

  const submit = async () => {
    if (submittingRef.current || !item) return;
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter the weight received back'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${item.id}/receive`, {
        weight: w, note,
        process_loss: parseFloat(processLoss) || 0,
        wastage_weight: parseFloat(wastageWeight) || 0,
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
    if (mode === 'form' && !routeItemId) { resetFormFields(); setItem(null); setMode('pick'); return; }
    router.back();
  };

  const headerTitle = mode === 'bulk' ? `Receive ${bulkItems.length} Tags` : mode === 'pick' ? 'Select Tag to Receive' : 'Receive from Karigar';

  if (loading && ((mode === 'form' && !item) || mode === 'bulk')) {
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
  const wastageNum = parseFloat(wastageWeight) || 0;
  const fineWastage = round3(wastageNum * purity / 100);
  const lossNum = parseFloat(processLoss) || 0;
  const fineLoss = round3(lossNum * purity / 100);
  const weightNum = parseFloat(weight) || 0;
  const fineReceived = round3(weightNum * purity / 100);
  // Wastage the karigar charges for is written off (same as this item's issued
  // gold) — process loss is reference-only and does not affect this figure.
  const balanceFine = weight ? round3(fineIssued - fineWastage - fineReceived) : null;
  // The karigar's fine-gold balance from everything else (other jobs), before
  // this item's own issued weight — folded back in so old balance carries
  // forward, matching how the ₹ side already works below.
  const otherFineBalance = round3(prevFineBalance - fineIssued);
  const totalFineBalance = balanceFine != null ? round3(otherFineBalance + balanceFine) : null;

  const labourNum = parseFloat(labourAmount) || 0;
  const cashNum = parseFloat(payCash) || 0;
  const metalValueNum = parseFloat(payMetalValue) || 0;
  const recvCashNum = parseFloat(recvCash) || 0;
  // Cash the karigar hands to the shop moves the balance the same direction
  // as the backend's 'receipt' entry (amt_due += amount) — it settles what
  // the karigar owes, it does not reduce what the shop owes the karigar.
  const remainingDue = round3(prevBalance + labourNum - cashNum - metalValueNum + recvCashNum);

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
      ) : mode === 'bulk' ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.hint}>Enter what came back for each tag. Process loss, pay/receive settlement, and labour stay per-tag on the individual receive screen.</Text>
            {bulkItems.map((it) => {
              const row = bulkRows[it.id] || { weight: '', wastageWeight: '' };
              return (
                <View key={it.id} style={styles.bulkRowCard} testID={`bulk-row-${it.id}`}>
                  <Text style={styles.cName}>{it.item_code} · {it.customer_name}</Text>
                  <Text style={styles.cMeta}>{it.description}{it.karigar_name ? ` · with ${it.karigar_name}` : ''} · issued {(it.current_issue_weight || 0).toFixed(3)}g</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Weight received (g)</Text>
                      <TextInput
                        testID={`bulk-weight-${it.id}`} value={row.weight}
                        onChangeText={(v) => setBulkRow(it.id, { weight: v.replace(/[^0-9.]/g, '') })}
                        keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Wastage charged (g)</Text>
                      <TextInput
                        testID={`bulk-wastage-${it.id}`} value={row.wastageWeight}
                        onChangeText={(v) => setBulkRow(it.id, { wastageWeight: v.replace(/[^0-9.]/g, '') })}
                        keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            <Pressable onPress={submitBulk} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="receive-bulk-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Receive {bulkItems.length} Tags</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : item ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{item.item_code} · {item.customer_name}</Text>
              <Text style={styles.cMeta}>{item.description}{item.karigar_name ? ` · with ${item.karigar_name}` : ''}</Text>
            </View>

            <View style={styles.fieldGrid} testID="receive-field-grid">
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Issued (g)</Text>
                <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{issuedWeight.toFixed(3)}</Text></View>
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Receive (g)</Text>
                <TextInput testID="receive-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Wastage (g) <Text style={{ color: colors.onSuccess }}>+</Text></Text>
                <TextInput testID="wastage-weight" value={wastageWeight} onChangeText={(v) => setWastageWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Loss (g) <Text style={{ color: colors.mutedText }}>−</Text></Text>
                <TextInput testID="process-loss" value={processLoss} onChangeText={(v) => setProcessLoss(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
            <Text style={styles.hint}>Wastage is what the karigar charges — it's written off against what they owe. Loss (filing, polishing, etc.) is kept for reference only and doesn't touch the ledger.</Text>

            <Text style={styles.sectionTitle}>Total</Text>
            <View style={styles.fieldGrid} testID="receive-total-row">
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Difference (g)</Text>
                <View style={styles.readonlyBox}>
                  <Text style={[styles.readonlyBoxText, weight && weightNum !== issuedWeight ? { color: weightNum > issuedWeight ? colors.onSuccess : colors.onError } : null]}>
                    {weight ? `${round3(weightNum - issuedWeight) >= 0 ? '+' : ''}${round3(weightNum - issuedWeight).toFixed(3)}` : '—'}
                  </Text>
                </View>
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Fine (g)</Text>
                <View style={styles.readonlyBox}>
                  <Text style={[styles.readonlyBoxText, balanceFine != null && balanceFine !== 0 ? { color: balanceFine > 0 ? colors.onWarning : colors.onSuccess } : null]}>
                    {balanceFine != null ? balanceFine.toFixed(3) : '—'}
                  </Text>
                </View>
              </View>
            </View>

            {!!otherFineBalance && (
              <View style={styles.balanceRow} testID="prev-fine-balance-row">
                <Text style={styles.balanceRowLabel}>Balance from other jobs</Text>
                <Text style={[styles.balanceRowValue, otherFineBalance > 0 ? { color: colors.onWarning } : { color: colors.onSuccess }]}>{otherFineBalance > 0 ? '+' : ''}{otherFineBalance.toFixed(3)}g</Text>
              </View>
            )}

            {totalFineBalance != null && (
              <View style={[styles.balancePreview, totalFineBalance > 0 && styles.balancePreviewNegative]} testID="receive-balance-preview">
                <Ionicons name={totalFineBalance === 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={14} color={totalFineBalance === 0 ? colors.onSuccess : colors.onError} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.balancePreviewText, { color: totalFineBalance === 0 ? colors.onSuccess : colors.onError }]}>
                    {totalFineBalance > 0 ? `Receivable: ${totalFineBalance.toFixed(3)}g fine gold — karigar still owes this` : totalFineBalance < 0 ? `Payable: ${Math.abs(totalFineBalance).toFixed(3)}g fine gold — owed back to karigar` : 'Fully accounted for'}
                  </Text>
                  <Text style={styles.balancePreviewSub}>Includes this tag plus any other balance — tap to clear the whole slip</Text>
                </View>
                {totalFineBalance > 0 && (
                  <Pressable onPress={() => setRecvMetalWeight(String(totalFineBalance.toFixed(3)))} style={styles.settleBtn} testID="settle-receive-btn">
                    <Text style={styles.settleBtnText}>Receive now</Text>
                  </Pressable>
                )}
                {totalFineBalance < 0 && (
                  <Pressable onPress={() => setPayMetalWeight(String(Math.abs(totalFineBalance).toFixed(3)))} style={styles.settleBtn} testID="settle-pay-btn">
                    <Text style={styles.settleBtnText}>Pay now</Text>
                  </Pressable>
                )}
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
  bulkRowCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },

  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fieldCol: { flexBasis: '47%', flexGrow: 1 },
  readonlyBox: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  readonlyBoxText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },

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
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.success,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.sm,
  },
  balancePreviewNegative: { backgroundColor: colors.error },
  balancePreviewText: { fontSize: 12, fontWeight: '700' },
  balancePreviewSub: { fontSize: 10, opacity: 0.8, marginTop: 2, color: colors.onSurface },
  settleBtn: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  settleBtnText: { color: colors.onSurface, fontSize: 11, fontWeight: '800' },

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
