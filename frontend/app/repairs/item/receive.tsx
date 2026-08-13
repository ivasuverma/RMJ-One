import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; description: string; customer_name: string; karigar_name: string | null;
  karigar_id?: string | null;
  current_issue_weight: number | null; current_issue_fine_weight?: number | null; purity?: number;
};
type Txn = {
  id: string; direction: 'issue' | 'receive'; weight: number; note: string; slip_photo?: string;
  process_loss?: number; wastage_weight?: number; recv_purity?: number;
  labour_amount?: number; pay_cash?: number; pay_metal_weight?: number; pay_metal_value?: number;
  recv_cash?: number; recv_metal_weight?: number;
};

type Mode = 'pick' | 'form' | 'bulk';
type BulkRow = { weight: string; wastageWeight: string };

function round3(n: number) { return Math.round(n * 1000) / 1000; }
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export default function ReceiveFromKarigarScreen() {
  const { itemId: routeItemId, itemIds: routeItemIds, txnId } = useLocalSearchParams<{ itemId: string; itemIds?: string; txnId?: string }>();
  const isEdit = !!txnId;
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
  const [recvPurity, setRecvPurity] = useState('');
  const [note, setNote] = useState('');
  const [slipPhoto, setSlipPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [labourAmount, setLabourAmount] = useState('');
  const [payCash, setPayCash] = useState('');
  const [payMetalWeight, setPayMetalWeight] = useState('');
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
        const res = await api.get<{ item: Item; history: Txn[] }>(`/repair-items/${routeItemId}`);
        setItem(res.item);
        if (txnId) {
          const txn = res.history.find((h) => h.id === txnId);
          if (txn) {
            setWeight(String(txn.weight ?? ''));
            setWastageWeight(txn.wastage_weight ? String(txn.wastage_weight) : '');
            setProcessLoss(txn.process_loss ? String(txn.process_loss) : '');
            setRecvPurity(String(txn.recv_purity ?? res.item.purity ?? 100));
            setNote(txn.note || '');
            setSlipPhoto(txn.slip_photo || '');
            setLabourAmount(txn.labour_amount ? String(txn.labour_amount) : '');
            setPayCash(txn.pay_cash ? String(txn.pay_cash) : '');
            setPayMetalWeight(txn.pay_metal_weight ? String(txn.pay_metal_weight) : '');
            setRecvCash(txn.recv_cash ? String(txn.recv_cash) : '');
            setRecvMetalWeight(txn.recv_metal_weight ? String(txn.recv_metal_weight) : '');
          }
        } else {
          setRecvPurity(String(res.item.purity ?? 100));
        }
        setMode('form');
        loadBalance(res.item.karigar_id);
      } else {
        setPickList(await api.get<Item[]>('/repair-items?status=with_karigar'));
        setMode('pick');
      }
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [routeItemId, loadBalance, bulkIds, txnId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetFormFields = () => {
    setWeight(''); setWastageWeight(''); setProcessLoss(''); setRecvPurity(''); setNote(''); setSlipPhoto('');
    setLabourAmount(''); setPayCash(''); setPayMetalWeight('');
    setRecvCash(''); setRecvMetalWeight(''); setPrevBalance(0);
  };

  const pickItem = (it: Item) => {
    resetFormFields(); setItem(it); setRecvPurity(String(it.purity ?? 100)); setMode('form'); loadBalance(it.karigar_id);
  };

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
    const payload = {
      weight: w, note, slip_photo: slipPhoto,
      process_loss: parseFloat(processLoss) || 0,
      wastage_weight: parseFloat(wastageWeight) || 0,
      purity_override: parseFloat(recvPurity) || undefined,
      labour_amount: parseFloat(labourAmount) || 0,
      pay_cash: parseFloat(payCash) || 0,
      pay_metal_weight: parseFloat(payMetalWeight) || 0,
      recv_cash: parseFloat(recvCash) || 0,
      recv_metal_weight: parseFloat(recvMetalWeight) || 0,
    };
    try {
      if (isEdit) {
        await api.put(`/repair-items/${item.id}/transactions/${txnId}`, payload);
      } else {
        await api.post(`/repair-items/${item.id}/receive`, payload);
      }
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const onBack = () => {
    if (mode === 'form' && !routeItemId) { resetFormFields(); setItem(null); setMode('pick'); return; }
    router.back();
  };

  const headerTitle = mode === 'bulk' ? `Receive ${bulkItems.length} Tags` : mode === 'pick' ? 'Select Tag to Receive' : isEdit ? 'Edit Receive' : 'Receive from Karigar';

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

  const issuePurity = item?.purity ?? 100;
  const issuedWeight = item?.current_issue_weight || 0;
  // Touch of what's coming back this time — editable, defaults to the item's
  // issued purity but can differ (mixed lots, karigar's own stated assay).
  const recvPurityNum = parseFloat(recvPurity) || issuePurity;
  const wastageNum = parseFloat(wastageWeight) || 0;
  const lossNum = parseFloat(processLoss) || 0;
  const weightNum = parseFloat(weight) || 0;
  // new_wt = issued - loss - wastage (what's expected back once both are
  // forgiven — wastage is the karigar's charge for the work, in their favor).
  // diff_wt = new_wt - received — the gross-gram gap this receive still
  // leaves outstanding. balance (fine g) = diff_wt x touch%.
  const newWt = round3(issuedWeight - lossNum - wastageNum);
  const diffWt = weight ? round3(newWt - weightNum) : 0;
  const balanceFine = weight ? round3(diffWt * recvPurityNum / 100) : null;
  const payMetalNum = parseFloat(payMetalWeight) || 0;
  const recvMetalNum = parseFloat(recvMetalWeight) || 0;
  // Pay/Receive Metal are entered in gross grams, but balanceFine is a fine-gram
  // figure — convert through this receive's touch before netting them, the
  // same way the backend does, or a gross-gram entry never quite cancels the
  // fine balance it's meant to settle.
  const remainingBalance = balanceFine != null
    ? round3(balanceFine - (recvMetalNum * recvPurityNum / 100) + (payMetalNum * recvPurityNum / 100))
    : null;

  const labourNum = parseFloat(labourAmount) || 0;
  const cashNum = parseFloat(payCash) || 0;
  const recvCashNum = parseFloat(recvCash) || 0;
  // Cash the karigar hands to the shop moves the balance the same direction
  // as the backend's 'receipt' entry (amt_due += amount) — it settles what
  // the karigar owes, it does not reduce what the shop owes the karigar.
  const remainingDue = round3(prevBalance + labourNum - cashNum + recvCashNum);

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
                <Text style={styles.label}>Loss (g)</Text>
                <TextInput testID="process-loss" value={processLoss} onChangeText={(v) => setProcessLoss(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>

            <View style={[styles.fieldGrid, { marginTop: 6 }]} testID="receive-total-row">
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Wastage (g)</Text>
                <TextInput testID="wastage-weight" value={wastageWeight} onChangeText={(v) => setWastageWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Diff (g)</Text>
                <View style={styles.readonlyBox}>
                  <Text style={[styles.readonlyBoxText, weight && diffWt !== 0 ? { color: diffWt > 0 ? colors.onWarning : colors.onSuccess } : null]}>
                    {weight ? `${diffWt >= 0 ? '+' : ''}${diffWt.toFixed(3)}` : '—'}
                  </Text>
                </View>
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>%</Text>
                <TextInput testID="recv-purity" value={recvPurity} onChangeText={(v) => setRecvPurity(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder={String(issuePurity)} placeholderTextColor={colors.mutedText} style={styles.input} />
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
            <Text style={styles.hint}>Loss and wastage are both forgiven — neither adds to what the karigar owes.</Text>

            <Text style={styles.label}>Karigar Slip Photo (optional)</Text>
            {slipPhoto ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: slipPhoto }} style={styles.photoThumb} />
                <Pressable onPress={() => setCameraOpen(true)} style={styles.smallBtn} testID="retake-slip-photo">
                  <Text style={styles.smallBtnText}>Retake</Text>
                </Pressable>
                <Pressable onPress={() => setSlipPhoto('')} style={styles.delBtn} hitSlop={10} testID="remove-slip-photo">
                  <Ionicons name="close" size={16} color={colors.onError} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="add-slip-photo">
                <Ionicons name="camera-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.smallBtnText}>Add Photo</Text>
              </Pressable>
            )}

            <Text style={styles.sectionTitle}>Total</Text>
            <View style={styles.readonlyBox} testID="settle-total">
              <Text style={[styles.readonlyBoxText, { textAlign: 'left' }, balanceFine != null && balanceFine !== 0 ? { color: balanceFine > 0 ? colors.onWarning : colors.onSuccess } : null]}>
                {balanceFine == null ? '—' : balanceFine > 0 ? `Receivable ${balanceFine.toFixed(3)}g fine — karigar still owes this` : balanceFine < 0 ? `Payable ${Math.abs(balanceFine).toFixed(3)}g fine — owed back to karigar` : 'Fully accounted for'}
              </Text>
            </View>

            {balanceFine != null && balanceFine !== 0 && (
              <Pressable
                onPress={() => {
                  // balanceFine is a fine-gram figure; Pay/Receive Metal are
                  // entered in gross grams — convert through this receive's
                  // touch so the fill actually zeroes the balance out.
                  const grossToSettle = round3(Math.abs(balanceFine) * 100 / recvPurityNum).toFixed(3);
                  if (balanceFine > 0) setRecvMetalWeight(grossToSettle);
                  else setPayMetalWeight(grossToSettle);
                }}
                style={styles.autopayBtn}
                testID="autopay-btn"
              >
                <Ionicons name="flash-outline" size={13} color={colors.onBrandPrimary} />
                <Text style={styles.autopayBtnText}>Autopay — {balanceFine > 0 ? 'fill Receive Metal' : 'fill Pay Metal'}</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Pay Metal (g)</Text>
            <TextInput testID="pay-metal-weight" value={payMetalWeight} onChangeText={(v) => setPayMetalWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Receive Metal (g)</Text>
            <TextInput testID="recv-metal-weight" value={recvMetalWeight} onChangeText={(v) => setRecvMetalWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Balance (g)</Text>
            <View style={styles.readonlyBox}>
              <Text style={[styles.readonlyBoxText, { textAlign: 'left' }, remainingBalance != null && remainingBalance !== 0 ? { color: remainingBalance > 0 ? colors.onWarning : colors.onSuccess } : { color: colors.onSuccess }]}>
                {remainingBalance == null ? '—' : remainingBalance === 0 ? 'Slip cleared — 0.000g' : `${remainingBalance > 0 ? '+' : ''}${remainingBalance.toFixed(3)}g`}
              </Text>
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="receive-note" value={note} onChangeText={setNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.sectionTitle}>Cash Settlement</Text>
            {!!prevBalance && (
              <View style={styles.balanceRow} testID="prev-balance-row">
                <Text style={styles.balanceRowLabel}>Previous balance</Text>
                <Text style={[styles.balanceRowValue, prevBalance > 0 ? { color: colors.onWarning } : { color: colors.onSuccess }]}>{fmtINR(Math.abs(prevBalance))}{prevBalance < 0 ? ' cr' : ''}</Text>
              </View>
            )}
            <Text style={styles.label}>Labour cash (₹)</Text>
            <TextInput testID="labour-amount" value={labourAmount} onChangeText={(v) => setLabourAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Cash paid (₹)</Text>
                <TextInput testID="pay-cash" value={payCash} onChangeText={(v) => setPayCash(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Cash received (₹)</Text>
                <TextInput testID="recv-cash" value={recvCash} onChangeText={(v) => setRecvCash(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>

            {(labourNum > 0 || !!prevBalance) && (
              <View style={styles.totalRow} testID="remaining-due">
                <Text style={styles.totalLabel}>{remainingDue > 0 ? 'Remaining Due' : remainingDue < 0 ? 'Overpaid' : 'Fully Settled'}</Text>
                <Text style={[styles.totalValue, remainingDue > 0 && { color: colors.onError }, remainingDue <= 0 && { color: colors.onSuccess }]}>{fmtINR(Math.abs(remainingDue))}</Text>
              </View>
            )}

            <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="receive-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{isEdit ? 'Save Changes' : 'Receive'}</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Karigar Slip"
        onClose={() => setCameraOpen(false)}
        onCapture={async (photo) => { setSlipPhoto(photo); setCameraOpen(false); }}
      />
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

  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldCol: { flexBasis: '21%', flexGrow: 1 },
  readonlyBox: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 10,
  },
  readonlyBoxText: { color: colors.onSurface, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  photoBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: 4,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photoThumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  autopayBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 8, marginTop: spacing.sm,
  },
  autopayBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800' },

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
