import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; order_id: string; order_no: string; customer_name: string;
  description: string; repair_type: string; material: string; gross_weight: number; pc_count: number;
  labour_charge: number; needs_karigar: boolean; due_date: string | null; notes: string;
  status: 'received' | 'with_karigar' | 'ready' | 'delivered';
  karigar_id: string | null; karigar_name: string | null; current_issue_weight: number | null;
  weight_diff?: number; customer_adjustment?: number; billed_amount: number | null; payment_mode: string | null;
  intake_photo?: string; final_photo?: string;
};
type Txn = {
  id: string; direction: 'issue' | 'receive'; karigar_name: string; weight: number; weight_diff?: number;
  note: string; challan_no: string; created_at: string; created_by: string;
};
type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };

const STATUS_LABEL: Record<Item['status'], string> = {
  received: 'Received', with_karigar: 'With Karigar', ready: 'Ready', delivered: 'Delivered',
};

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

  // Deliver
  const [billedAmount, setBilledAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [finalPhoto, setFinalPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const resetForms = () => {
    setForm(null); setPickedKarigar(null); setIssueWeight(''); setIssueNote('');
    setRecvWeight(''); setRecvNote(''); setAdjAmount(''); setAdjNote(''); setChargeTo('none');
    setBilledAmount(''); setPaymentMode('cash'); setFinalPhoto('');
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

  const doDeliver = async () => {
    if (submittingRef.current || !item) return;
    const amt = parseFloat(billedAmount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Enter the billed amount'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${id}/deliver`, { billed_amount: amt, payment_mode: paymentMode, note: '', final_photo: finalPhoto });
      resetForms(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const [printing, setPrinting] = useState(false);
  const viewBill = async () => {
    setPrinting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/repair-items/${id}/bill/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Bill failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Bill generated', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrinting(false); }
  };

  if (loading || !item) {
    return <SafeAreaView style={styles.root} edges={['top']}><View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-item-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{item.item_code}</Text>
        <View style={[styles.statusBadge, badgeStyle(item.status, colors)]}>
          <Text style={styles.statusText}>{STATUS_LABEL[item.status]}</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <MetaRow icon="document-text-outline" label="Item" value={item.description} colors={colors} />
            <MetaRow icon="construct-outline" label="Type" value={item.repair_type || '—'} colors={colors} />
            <MetaRow icon="scale-outline" label="Weight" value={`${item.gross_weight.toFixed(3)}g · ${item.pc_count} pc${item.pc_count === 1 ? '' : 's'}`} colors={colors} />
            <MetaRow icon="cash-outline" label="Labour" value={`₹${item.labour_charge.toFixed(0)}`} colors={colors} />
            <MetaRow icon="calendar-outline" label="Due" value={item.due_date || '—'} colors={colors} />
            <MetaRow icon="person-outline" label="Customer" value={`${item.customer_name} · ${item.order_no}`} colors={colors} />
            {item.karigar_name && <MetaRow icon="hammer-outline" label="Karigar" value={item.karigar_name} colors={colors} />}
            {item.weight_diff != null && <MetaRow icon="swap-vertical-outline" label="Weight diff" value={`${item.weight_diff >= 0 ? '+' : ''}${item.weight_diff.toFixed(3)}g`} colors={colors} />}
            {item.billed_amount != null && <MetaRow icon="receipt-outline" label="Billed" value={`₹${item.billed_amount.toFixed(0)} · ${item.payment_mode}`} colors={colors} />}
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
              <Pressable onPress={() => setForm(form === 'issue' ? null : 'issue')} style={styles.actionBtn} testID="show-issue-form">
                <Ionicons name="arrow-redo-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Issue to Karigar</Text>
              </Pressable>
              <Pressable onPress={() => setForm(form === 'deliver' ? null : 'deliver')} style={[styles.actionBtn, styles.actionBtnPrimary]} testID="show-deliver-form">
                <Ionicons name="cart-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Deliver & Bill</Text>
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
            <Pressable onPress={viewBill} disabled={printing} style={[styles.actionBtn, styles.actionBtnPrimary, { marginBottom: spacing.lg }]} testID="view-bill-btn">
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
              <TextInput testID="issue-weight" value={issueWeight} onChangeText={(v) => setIssueWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="issue-note" value={issueNote} onChangeText={setIssueNote} placeholder="Instructions for the karigar" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={doIssue} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="issue-save-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Issue</Text>}
              </Pressable>
            </View>
          )}

          {form === 'receive' && (
            <View style={styles.formCard} testID="receive-form">
              <Text style={styles.hint}>Issued weight was {item.current_issue_weight?.toFixed(3) ?? '0.000'}g. Enter what came back — you decide any wastage or charge manually.</Text>
              <Text style={styles.label}>Weight received (g)</Text>
              <TextInput testID="receive-weight" value={recvWeight} onChangeText={(v) => setRecvWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
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
                  <TextInput testID="adj-amount" value={adjAmount} onChangeText={(v) => setAdjAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
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
              <Text style={styles.label}>Billed amount (₹)</Text>
              <TextInput testID="deliver-amount" value={billedAmount} onChangeText={(v) => setBilledAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
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
          ) : history.map((h) => (
            <View key={h.id} style={styles.histRow} testID={`hist-${h.id}`}>
              <View style={styles.iconBox}>
                <Ionicons name={h.direction === 'issue' ? 'arrow-redo-outline' : 'arrow-undo-outline'} size={16} color={colors.brandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{h.direction === 'issue' ? 'Issued to' : 'Received from'} {h.karigar_name} · {h.challan_no}</Text>
                <Text style={styles.cMeta}>{h.weight.toFixed(3)}g{h.weight_diff != null ? ` (${h.weight_diff >= 0 ? '+' : ''}${h.weight_diff.toFixed(3)}g)` : ''} · {h.note || '—'} · {h.created_at?.slice(0, 10)} · {h.created_by}</Text>
              </View>
            </View>
          ))}
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

function badgeStyle(status: Item['status'], colors: ThemeColors) {
  if (status === 'delivered') return { backgroundColor: colors.success, borderColor: colors.onSuccess };
  if (status === 'ready') return { backgroundColor: colors.brandTertiary, borderColor: colors.brand };
  return { backgroundColor: colors.surfaceTertiary, borderColor: colors.border };
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

  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  chip: { flexGrow: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.md },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusText: { fontSize: 9, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
