import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { confirmAction } from '@/src/utils/confirm';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { REPAIR_STATUS_LABEL, repairStatusColors, RepairItemStatus } from '@/src/utils/repairStatus';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; order_id: string; order_no: string; customer_name: string;
  item_type_name?: string; purity?: number; fine_weight?: number;
  description: string; repair_type: string; gross_weight: number; pc_count: number;
  labour_charge: number; needs_karigar: boolean; due_date: string | null; notes: string;
  status: RepairItemStatus;
  karigar_id: string | null; karigar_name: string | null;
  current_issue_weight: number | null; current_issue_fine_weight?: number | null;
  weight_diff?: number; fine_weight_diff?: number; customer_adjustment?: number;
  bill_labour_charge?: number; bill_material_adjustment?: number; bill_extra_charges?: number; bill_extra_charges_note?: string;
  billed_amount: number | null; payment_mode: string | null;
  intake_photo?: string; final_photo?: string;
  created_by?: string; updated_by?: string;
};
type Txn = {
  id: string; direction: 'issue' | 'receive'; karigar_name: string; weight: number; fine_weight?: number;
  weight_diff?: number; fine_weight_diff?: number;
  note: string; challan_no: string; created_at: string; created_by: string; edited_at?: string; edited_by?: string;
};
type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };

export default function RepairItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<Txn[]>([]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [res, ks] = await Promise.all([
        api.get<{ item: Item; history: Txn[] }>(`/repair-items/${id}`),
        api.get<Karigar[]>('/karigars'),
      ]);
      setItem(res.item); setHistory(res.history); setKarigars(ks);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Which inline form is open
  const [form, setForm] = useState<null | 'issue' | 'receive' | 'deliver'>(null);

  // Issue
  const [kPickerOpen, setKPickerOpen] = useState(false);
  const [pickedKarigar, setPickedKarigar] = useState<Karigar | null>(null);
  const [issueWeight, setIssueWeight] = useState('');
  const [issueNote, setIssueNote] = useState('');

  // Receive
  const [recvWeight, setRecvWeight] = useState('');
  const [recvNote, setRecvNote] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [chargeTo, setChargeTo] = useState<'customer' | 'karigar' | 'none'>('none');

  // Bill / Deliver
  const [billLabour, setBillLabour] = useState('');
  const [billMaterial, setBillMaterial] = useState('');
  const [billExtra, setBillExtra] = useState('');
  const [billExtraNote, setBillExtraNote] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [finalPhoto, setFinalPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  // Transaction edit
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editNote, setEditNote] = useState('');

  const resetForms = () => {
    setForm(null); setPickedKarigar(null); setIssueWeight(''); setIssueNote('');
    setRecvWeight(''); setRecvNote(''); setAdjAmount(''); setAdjNote(''); setChargeTo('none');
    setBillLabour(''); setBillMaterial(''); setBillExtra(''); setBillExtraNote(''); setPaymentMode('cash'); setFinalPhoto('');
  };

  const openDeliverForm = () => {
    if (!item) return;
    setBillLabour(String(item.labour_charge || 0));
    setBillMaterial(String(item.customer_adjustment || 0));
    setForm(form === 'deliver' ? null : 'deliver');
  };

  const doIssue = async () => {
    if (submittingRef.current || !item) return;
    if (!pickedKarigar) { Alert.alert('Missing', 'Pick a karigar'); return; }
    const w = parseFloat(issueWeight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter the weight being issued'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${id}/issue`, { karigar_id: pickedKarigar.id, weight: w, note: issueNote });
      resetForms(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const doReceive = async () => {
    if (submittingRef.current || !item) return;
    const w = parseFloat(recvWeight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter the weight received back'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${id}/receive`, {
        weight: w, note: recvNote, adjustment_amount: parseFloat(adjAmount) || 0,
        adjustment_note: adjNote, charge_to: chargeTo,
      });
      resetForms(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const doReady = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true; setBusy(true);
    try { await api.post(`/repair-items/${id}/ready`, {}); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const billTotal = (parseFloat(billLabour) || 0) + (parseFloat(billMaterial) || 0) + (parseFloat(billExtra) || 0);

  const doDeliver = async () => {
    if (submittingRef.current || !item) return;
    if (billTotal <= 0) { Alert.alert('Invalid', 'The billed total must be greater than 0'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${id}/deliver`, {
        labour_charge: parseFloat(billLabour) || 0, material_adjustment: parseFloat(billMaterial) || 0,
        extra_charges: parseFloat(billExtra) || 0, extra_charges_note: billExtraNote,
        payment_mode: paymentMode, note: '', final_photo: finalPhoto,
      });
      resetForms(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const startEditTxn = (t: Txn) => { setEditingTxnId(t.id); setEditWeight(String(t.weight)); setEditNote(t.note || ''); };
  const cancelEditTxn = () => { setEditingTxnId(null); setEditWeight(''); setEditNote(''); };

  const saveEditTxn = async () => {
    if (submittingRef.current || !editingTxnId) return;
    const w = parseFloat(editWeight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter a weight greater than 0'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.put(`/repair-items/${id}/transactions/${editingTxnId}`, { weight: w, note: editNote });
      cancelEditTxn(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const deleteTxn = (t: Txn) => {
    confirmAction(
      t.direction === 'issue' ? 'Delete issue' : 'Delete receive',
      `This will undo this ${t.direction} and move the item's status back. Continue?`,
      'Delete',
      async () => {
        try { await api.del(`/repair-items/${id}/transactions/${t.id}`); await load(); }
        catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this entry.'); }
      },
    );
  };

  const [printing, setPrinting] = useState(false);
  const printPdf = async (kind: 'bill' | 'issue-slip') => {
    setPrinting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const path = kind === 'bill' ? `/repair-items/${id}/bill/pdf` : `/repair-items/${id}/issue-slip/pdf`;
      const url = `${base}/api${path}`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Print failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Ready', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrinting(false); }
  };

  if (loading || !item) {
    return <SafeAreaView style={styles.root} edges={['top']}><View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  }

  const sc = repairStatusColors(item.status, colors);
  const recvWeightNum = parseFloat(recvWeight) || 0;
  const issuedWeight = item.current_issue_weight || 0;
  const liveDiff = recvWeight ? round3(recvWeightNum - issuedWeight) : null;
  const purity = item.purity ?? 100;
  const liveFineDiff = recvWeight ? round3(recvWeightNum * purity / 100 - (item.current_issue_fine_weight ?? issuedWeight * purity / 100)) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-item-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{item.item_code}</Text>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
          <Text style={[styles.statusText, { color: sc.fg }]}>{REPAIR_STATUS_LABEL[item.status]}</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {item.item_type_name ? <MetaRow icon="diamond-outline" label="Item Type" value={`${item.item_type_name} · ${purity}%`} colors={colors} /> : null}
            <MetaRow icon="document-text-outline" label="Item" value={item.description} colors={colors} />
            <MetaRow icon="construct-outline" label="Type" value={item.repair_type || '—'} colors={colors} />
            <MetaRow icon="scale-outline" label="Weight" value={`${item.gross_weight.toFixed(3)}g · ${item.pc_count} pc${item.pc_count === 1 ? '' : 's'}`} colors={colors} />
            {item.fine_weight != null && <MetaRow icon="water-outline" label="Fine Weight" value={`${item.fine_weight.toFixed(3)}g`} colors={colors} />}
            <MetaRow icon="cash-outline" label="Labour" value={`₹${item.labour_charge.toFixed(0)}`} colors={colors} />
            <MetaRow icon="calendar-outline" label="Due" value={item.due_date || '—'} colors={colors} />
            <MetaRow icon="person-outline" label="Customer" value={`${item.customer_name} · ${item.order_no}`} colors={colors} />
            {item.karigar_name && <MetaRow icon="hammer-outline" label="Karigar" value={item.karigar_name} colors={colors} />}
            {item.weight_diff != null && <MetaRow icon="swap-vertical-outline" label="Weight diff" value={`${item.weight_diff >= 0 ? '+' : ''}${item.weight_diff.toFixed(3)}g${item.fine_weight_diff != null ? ` (fine ${item.fine_weight_diff >= 0 ? '+' : ''}${item.fine_weight_diff.toFixed(3)}g)` : ''}`} colors={colors} />}
            {item.billed_amount != null && <MetaRow icon="receipt-outline" label="Billed" value={`₹${item.billed_amount.toFixed(0)} · ${item.payment_mode}`} colors={colors} />}
            {item.created_by && <MetaRow icon="person-add-outline" label="Intake by" value={item.created_by} colors={colors} />}
            {item.updated_by && <MetaRow icon="pencil-outline" label="Last by" value={item.updated_by} colors={colors} />}
          </View>

          {(item.intake_photo || item.final_photo) && (
            <View style={styles.photosRow}>
              {item.intake_photo && (
                <View style={{ alignItems: 'center' }}>
                  <Image source={{ uri: item.intake_photo }} style={styles.photoLarge} />
                  <Text style={styles.photoCaption}>Intake</Text>
                </View>
              )}
              {item.final_photo && (
                <View style={{ alignItems: 'center' }}>
                  <Image source={{ uri: item.final_photo }} style={styles.photoLarge} />
                  <Text style={styles.photoCaption}>Delivery</Text>
                </View>
              )}
            </View>
          )}

          {item.karigar_name && (
            <Pressable onPress={() => printPdf('issue-slip')} disabled={printing} style={[styles.actionBtn, { marginBottom: spacing.md }]} testID="print-issue-slip-btn">
              {printing ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Thermal Slip (Karigar Issue)</Text></>}
            </Pressable>
          )}

          {/* Actions */}
          {item.status === 'received' && (
            <View style={styles.actionsRow}>
              <Pressable onPress={() => setForm(form === 'issue' ? null : 'issue')} style={styles.actionBtn} testID="show-issue-form">
                <Ionicons name="arrow-redo-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Issue to Karigar</Text>
              </Pressable>
              <Pressable onPress={doReady} disabled={busy} style={[styles.actionBtn, styles.actionBtnPrimary]} testID="mark-ready-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Mark Ready</Text></>}
              </Pressable>
            </View>
          )}
          {item.status === 'ready' && (
            <View style={styles.actionsRow}>
              <Pressable onPress={openDeliverForm} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="show-deliver-form">
                <Ionicons name="cart-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Bill Repair</Text>
              </Pressable>
            </View>
          )}
          {item.status === 'with_karigar' && (
            <View style={styles.actionsRow}>
              <Pressable onPress={() => setForm(form === 'receive' ? null : 'receive')} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="show-receive-form">
                <Ionicons name="arrow-undo-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Receive from Karigar</Text>
              </Pressable>
            </View>
          )}
          {item.status === 'delivered' && (
            <Pressable onPress={() => printPdf('bill')} disabled={printing} style={[styles.actionBtn, styles.actionBtnPrimary, { marginBottom: spacing.lg }]} testID="view-bill-btn">
              {printing ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>View Repair Bill</Text></>}
            </Pressable>
          )}

          {form === 'issue' && (
            <View style={styles.formCard} testID="issue-form">
              <Text style={styles.label}>Karigar</Text>
              <Pressable onPress={() => setKPickerOpen((v) => !v)} style={styles.picker} testID="issue-karigar-toggle">
                <Text style={pickedKarigar ? styles.pickerValue : styles.pickerPlaceholder}>{pickedKarigar ? pickedKarigar.name : 'Choose a karigar'}</Text>
                <Ionicons name={kPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {kPickerOpen && (
                <View style={styles.pickerList}>
                  {karigars.map((k) => (
                    <Pressable key={k.id} onPress={() => { setPickedKarigar(k); setKPickerOpen(false); }} style={styles.pickerRow} testID={`issue-karigar-${k.id}`}>
                      <Text style={styles.pickerRowName}>{k.name}</Text>
                      <Text style={styles.pickerRowMeta}>{k.is_employee ? 'In-house' : 'Outside'}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={styles.label}>Weight issued (g)</Text>
              <TextInput testID="issue-weight" value={issueWeight} onChangeText={(v) => setIssueWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="issue-note" value={issueNote} onChangeText={setIssueNote} placeholder="Instructions for the karigar" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={doIssue} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="issue-save-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Issue</Text>}
              </Pressable>
            </View>
          )}

          {form === 'receive' && (
            <View style={styles.formCard} testID="receive-form">
              <Text style={styles.hint}>Issued weight was {issuedWeight.toFixed(3)}g. Enter what came back — you decide any wastage or charge manually.</Text>
              <Text style={styles.label}>Weight received (g)</Text>
              <TextInput testID="receive-weight" value={recvWeight} onChangeText={(v) => setRecvWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              {liveDiff != null && (
                <View style={[styles.balancePreview, liveDiff < 0 && styles.balancePreviewNegative]} testID="receive-balance-preview">
                  <Ionicons name={liveDiff >= 0 ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={liveDiff >= 0 ? colors.onSuccess : colors.onError} />
                  <Text style={[styles.balancePreviewText, { color: liveDiff >= 0 ? colors.onSuccess : colors.onError }]}>
                    Balance vs issued: {liveDiff >= 0 ? '+' : ''}{liveDiff.toFixed(3)}g (fine {liveFineDiff != null && liveFineDiff >= 0 ? '+' : ''}{liveFineDiff?.toFixed(3)}g)
                  </Text>
                </View>
              )}
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="receive-note" value={recvNote} onChangeText={setRecvNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

              <Text style={[styles.label, { marginTop: spacing.md }]}>Charge any wastage/adjustment to</Text>
              <View style={styles.chipRow}>
                {(['none', 'customer', 'karigar'] as const).map((c) => (
                  <Pressable key={c} onPress={() => setChargeTo(c)} style={[styles.chip, chargeTo === c && styles.chipActive]} testID={`charge-${c}`}>
                    <Text style={[styles.chipText, chargeTo === c && styles.chipTextActive]}>{c[0].toUpperCase() + c.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>
              {chargeTo !== 'none' && (
                <>
                  <Text style={styles.label}>Adjustment amount (₹)</Text>
                  <TextInput testID="adj-amount" value={adjAmount} onChangeText={(v) => setAdjAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
                  <Text style={styles.label}>Reason (optional)</Text>
                  <TextInput testID="adj-note" value={adjNote} onChangeText={setAdjNote} placeholder="e.g. melting loss" placeholderTextColor={colors.mutedText} style={styles.input} />
                </>
              )}
              <Pressable onPress={doReceive} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="receive-save-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Receive</Text>}
              </Pressable>
            </View>
          )}

          {form === 'deliver' && (
            <View style={styles.formCard} testID="deliver-form">
              <Text style={styles.section}>Bill Repair</Text>
              <Text style={styles.label}>Labour Charge (₹)</Text>
              <TextInput testID="deliver-labour" value={billLabour} onChangeText={(v) => setBillLabour(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Material / Wastage Adjustment (₹)</Text>
              <TextInput testID="deliver-material" value={billMaterial} onChangeText={(v) => setBillMaterial(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Extra Charges (₹)</Text>
              <TextInput testID="deliver-extra" value={billExtra} onChangeText={(v) => setBillExtra(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              {(parseFloat(billExtra) || 0) > 0 && (
                <TextInput testID="deliver-extra-note" value={billExtraNote} onChangeText={setBillExtraNote} placeholder="What's this extra charge for?" placeholderTextColor={colors.mutedText} style={styles.input} />
              )}
              <View style={styles.totalRow} testID="deliver-total">
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

              <Text style={styles.label}>Final Photo (optional)</Text>
              {finalPhoto ? (
                <View style={styles.photoRow}>
                  <Image source={{ uri: finalPhoto }} style={styles.photoThumb} />
                  <Pressable onPress={() => setCameraOpen(true)} style={styles.smallBtn} testID="deliver-retake-photo">
                    <Text style={styles.smallBtnText}>Retake</Text>
                  </Pressable>
                  <Pressable onPress={() => setFinalPhoto('')} style={styles.delBtn} hitSlop={10} testID="deliver-remove-photo">
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="deliver-add-photo">
                  <Ionicons name="camera-outline" size={16} color={colors.onSurfaceSecondary} />
                  <Text style={styles.actionBtnText}>Add Photo</Text>
                </Pressable>
              )}

              <Pressable onPress={doDeliver} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="deliver-save-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Deliver & Bill</Text>}
              </Pressable>
            </View>
          )}

          <Text style={styles.section}>Tag History · {history.length}</Text>
          {history.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No karigar transactions yet</Text></View>
          ) : history.map((h) => {
            const canEdit = item.status !== 'delivered' && (
              (h.direction === 'issue' && item.status === 'with_karigar') ||
              (h.direction === 'receive' && item.status === 'ready')
            );
            return (
              <View key={h.id} style={styles.histRow} testID={`hist-${h.id}`}>
                <View style={styles.histTop}>
                  <View style={styles.iconBox}>
                    <Ionicons name={h.direction === 'issue' ? 'arrow-redo-outline' : 'arrow-undo-outline'} size={16} color={colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{h.direction === 'issue' ? 'Issued to' : 'Received from'} {h.karigar_name} · {h.challan_no}</Text>
                    <Text style={styles.cMeta}>{h.weight.toFixed(3)}g{h.fine_weight != null ? ` (fine ${h.fine_weight.toFixed(3)}g)` : ''}{h.weight_diff != null ? ` · diff ${h.weight_diff >= 0 ? '+' : ''}${h.weight_diff.toFixed(3)}g` : ''}</Text>
                    <Text style={styles.cMeta}>{h.note || '—'} · {h.created_at?.slice(0, 10)} · {h.created_by}{h.edited_by ? ` · edited by ${h.edited_by}` : ''}</Text>
                  </View>
                  {canEdit && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable onPress={() => startEditTxn(h)} style={styles.smallIconBtn} hitSlop={8} testID={`edit-txn-${h.id}`}>
                        <Ionicons name="pencil-outline" size={14} color={colors.onSurfaceSecondary} />
                      </Pressable>
                      <Pressable onPress={() => deleteTxn(h)} style={[styles.smallIconBtn, styles.smallIconBtnDanger]} hitSlop={8} testID={`delete-txn-${h.id}`}>
                        <Ionicons name="trash-outline" size={14} color={colors.onError} />
                      </Pressable>
                    </View>
                  )}
                </View>
                {editingTxnId === h.id && (
                  <View style={styles.editTxnBox} testID={`edit-txn-form-${h.id}`}>
                    <Text style={styles.label}>Corrected weight (g)</Text>
                    <TextInput testID={`edit-txn-weight-${h.id}`} value={editWeight} onChangeText={(v) => setEditWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                    <Text style={styles.label}>Note</Text>
                    <TextInput testID={`edit-txn-note-${h.id}`} value={editNote} onChangeText={setEditNote} placeholderTextColor={colors.mutedText} style={styles.input} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Pressable onPress={cancelEditTxn} style={[styles.smallBtn, { flex: 1, alignItems: 'center' }]} testID={`cancel-edit-txn-${h.id}`}>
                        <Text style={styles.smallBtnText}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={saveEditTxn} disabled={busy} style={[styles.saveBtn, { flex: 1, marginTop: 0 }]} testID={`save-edit-txn-${h.id}`}>
                        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Final Photo"
        onClose={() => setCameraOpen(false)}
        onCapture={async (photo) => { setFinalPhoto(photo); setCameraOpen(false); }}
      />
    </SafeAreaView>
  );
}

function round3(n: number) { return Math.round(n * 1000) / 1000; }

function MetaRow({ icon, label, value, colors }: { icon: any; label: string; value: string; colors: ThemeColors }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color={colors.brandSecondary} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
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

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  metaLabel: { color: colors.mutedText, fontSize: 12, width: 80 },
  metaValue: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  photosRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg },
  photoLarge: { width: 96, height: 96, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary },
  photoCaption: { color: colors.mutedText, fontSize: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  photoBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: 4,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photoThumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionBtnPrimaryText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm, lineHeight: 17 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  balancePreview: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.success,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: 6,
  },
  balancePreviewNegative: { backgroundColor: colors.error },
  balancePreviewText: { fontSize: 12, fontWeight: '700' },

  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  chip: { flexGrow: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  totalLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  totalValue: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.md },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  histRow: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  histTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBox: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  smallIconBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  smallIconBtnDanger: { backgroundColor: colors.error, borderColor: colors.onError },
  editTxnBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
});
