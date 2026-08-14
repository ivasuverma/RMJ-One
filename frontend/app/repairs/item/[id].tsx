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
import { DateField } from '@/src/components/DateField';
import { REPAIR_STATUS_LABEL, repairStatusColors, RepairItemStatus } from '@/src/utils/repairStatus';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

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
export default function RepairItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { hasRight } = useAuth();
  const canEditRepair = hasRight('repairs', 'edit');
  const canDeleteRepair = hasRight('repairs', 'delete');

  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ item: Item; history: Txn[] }>(`/repair-items/${id}`);
      setItem(res.item); setHistory(res.history);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Which inline form is open
  const [form, setForm] = useState<null | 'edit'>(null);

  // Edit repair
  const [editDescription, setEditDescription] = useState('');
  const [editRepairType, setEditRepairType] = useState('');
  const [editGrossWeight, setEditGrossWeight] = useState('');
  const [editPcCount, setEditPcCount] = useState('');
  const [editLabourCharge, setEditLabourCharge] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const resetForms = () => { setForm(null); };

  const openEditForm = () => {
    if (!item) return;
    if (form === 'edit') { setForm(null); return; }
    setEditDescription(item.description || '');
    setEditRepairType(item.repair_type || '');
    setEditGrossWeight(String(item.gross_weight ?? ''));
    setEditPcCount(String(item.pc_count ?? '1'));
    setEditLabourCharge(String(item.labour_charge ?? ''));
    setEditDueDate(item.due_date || '');
    setEditNotes(item.notes || '');
    setForm('edit');
  };

  const weightLocked = item ? item.status !== 'received' : false;
  const labourLocked = item?.status === 'delivered';

  const saveEdit = async () => {
    if (submittingRef.current || !item) return;
    if (!editDescription.trim()) { Alert.alert('Missing', 'Enter a description'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      const body: any = {
        description: editDescription.trim(), repair_type: editRepairType,
        pc_count: parseInt(editPcCount, 10) || 1, due_date: editDueDate || null, notes: editNotes,
      };
      if (!weightLocked) body.gross_weight = parseFloat(editGrossWeight) || 0;
      if (!labourLocked) body.labour_charge = parseFloat(editLabourCharge) || 0;
      await api.put(`/repair-items/${id}`, body);
      setForm(null); await load();
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

  const doDeleteItem = () => {
    if (!item) return;
    confirmAction(
      'Delete this tag',
      `Delete ${item.item_code} · ${item.description}? This cannot be undone.`,
      'Delete',
      async () => {
        try {
          await api.del(`/repair-items/${id}`);
          router.back();
        } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this tag.'); }
      },
    );
  };

  // Editing a transaction opens the same full issue/receive form used to
  // create it, pre-filled — not a stripped-down weight-only box.
  const editTxn = (t: Txn) => {
    const pathname = t.direction === 'issue' ? '/repairs/item/issue' : '/repairs/item/receive';
    router.push({ pathname, params: { itemId: id, txnId: t.id } } as any);
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

  const [thermalPrinting, setThermalPrinting] = useState(false);
  // Sends straight to the WiFi thermal receipt printer configured in Store
  // Settings (raw ESC/POS over TCP) instead of generating a PDF.
  const printThermal = async (kind: 'bill' | 'issue-slip') => {
    setThermalPrinting(true);
    try {
      const path = kind === 'bill' ? `/repair-items/${id}/bill/print` : `/repair-items/${id}/issue-slip/print`;
      await api.post(path, {});
    } catch (e: any) { Alert.alert('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
    finally { setThermalPrinting(false); }
  };

  if (loading || !item) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const sc = repairStatusColors(item.status, colors);
  const purity = item.purity ?? 100;

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
        {canEditRepair && (
          <Pressable onPress={openEditForm} style={styles.editIconBtn} testID="edit-item-btn" hitSlop={12}>
            <Ionicons name={form === 'edit' ? 'close' : 'pencil-outline'} size={18} color={colors.onSurface} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {item.item_type_name ? <MetaRow icon="diamond-outline" label="Item Type" value={`${item.item_type_name} · ${purity}%`} colors={colors} /> : null}
            <MetaRow icon="document-text-outline" label="Item" value={item.description} colors={colors} />
            <MetaRow icon="construct-outline" label="Type" value={item.repair_type || '—'} colors={colors} />
            <MetaRow icon="scale-outline" label="Weight" value={`${item.gross_weight.toFixed(3)}g · ${item.pc_count} pc${item.pc_count === 1 ? '' : 's'}`} colors={colors} />
            {item.fine_weight != null && <MetaRow icon="water-outline" label="Fine Weight" value={`${item.fine_weight.toFixed(3)}g`} colors={colors} />}
            <MetaRow icon="cash-outline" label="Labour" value={`₹${(item.status === 'delivered' ? (item.bill_labour_charge ?? item.labour_charge) : item.labour_charge).toFixed(0)}`} colors={colors} />
            <MetaRow icon="calendar-outline" label="Due" value={item.due_date || '—'} colors={colors} />
            <MetaRow icon="person-outline" label="Customer" value={`${item.customer_name} · ${item.order_no}`} colors={colors} />
            {item.karigar_name && <MetaRow icon="hammer-outline" label="Karigar" value={item.karigar_name} colors={colors} />}
            {item.weight_diff != null && <MetaRow icon="swap-vertical-outline" label="Weight diff" value={`${item.weight_diff >= 0 ? '+' : ''}${item.weight_diff.toFixed(3)}g${item.fine_weight_diff != null ? ` (fine ${item.fine_weight_diff >= 0 ? '+' : ''}${item.fine_weight_diff.toFixed(3)}g)` : ''}`} colors={colors} />}
            {item.billed_amount != null && <MetaRow icon="receipt-outline" label="Billed" value={`₹${item.billed_amount.toFixed(0)} · ${item.payment_mode}`} colors={colors} />}
            {item.created_by && <MetaRow icon="person-add-outline" label="Intake by" value={item.created_by} colors={colors} />}
            {item.updated_by && <MetaRow icon="pencil-outline" label="Last by" value={item.updated_by} colors={colors} />}
          </View>

          {form === 'edit' && (
            <View style={styles.formCard} testID="edit-form">
              <Text style={styles.section}>Edit Repair</Text>
              {item.status === 'delivered' && (
                <Text style={styles.hint}>This tag has already been billed — changes here update the record only, not the printed bill.</Text>
              )}
              <Text style={styles.label}>Description</Text>
              <TextInput testID="edit-description" value={editDescription} onChangeText={setEditDescription} placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Repair Type</Text>
              <TextInput testID="edit-repair-type" value={editRepairType} onChangeText={setEditRepairType} placeholderTextColor={colors.mutedText} style={styles.input} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Gross Weight (g){weightLocked ? ' — locked' : ''}</Text>
                  <TextInput testID="edit-weight" editable={!weightLocked} value={editGrossWeight} onChangeText={(v) => setEditGrossWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.mutedText} style={[styles.input, weightLocked && styles.inputLocked]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Pieces</Text>
                  <TextInput testID="edit-pcs" value={editPcCount} onChangeText={(v) => setEditPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
              </View>
              {weightLocked && <Text style={styles.hint}>Weight is locked once a tag has been issued to a karigar, to keep the karigar ledger accurate.</Text>}
              <Text style={styles.label}>Labour Charge (₹){labourLocked ? ' — locked' : ''}</Text>
              <TextInput testID="edit-labour" editable={!labourLocked} value={editLabourCharge} onChangeText={(v) => setEditLabourCharge(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.mutedText} style={[styles.input, labourLocked && styles.inputLocked]} />
              <DateField label="Due Date" value={editDueDate} onChange={setEditDueDate} testID="edit-due" />
              <Text style={styles.label}>Notes</Text>
              <TextInput testID="edit-notes" value={editNotes} onChangeText={setEditNotes} placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={saveEdit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="edit-save-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </Pressable>
            </View>
          )}

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
            <Pressable onPress={() => printThermal('issue-slip')} disabled={thermalPrinting} style={[styles.actionBtn, { marginBottom: spacing.md }]} testID="print-issue-slip-btn">
              {thermalPrinting ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Thermal Slip (Karigar Issue)</Text></>}
            </Pressable>
          )}

          {/* Actions */}
          {item.status === 'received' && (
            <>
              <View style={styles.actionsRow}>
                <Pressable onPress={() => router.push({ pathname: '/repairs/item/issue', params: { itemId: id } } as any)} style={styles.actionBtn} testID="show-issue-form">
                  <Ionicons name="arrow-redo-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Issue to Karigar</Text>
                </Pressable>
                <Pressable onPress={doReady} disabled={busy} style={[styles.actionBtn, styles.actionBtnPrimary]} testID="mark-ready-btn">
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Mark Ready</Text></>}
                </Pressable>
              </View>
              {canDeleteRepair && (
                <Pressable onPress={doDeleteItem} disabled={busy} style={[styles.actionBtn, styles.deleteWideBtn, { marginBottom: spacing.md }]} testID="delete-item-btn">
                  <Ionicons name="trash-outline" size={16} color={colors.onError} /><Text style={[styles.actionBtnText, { color: colors.onError }]}>Delete This Tag</Text>
                </Pressable>
              )}
            </>
          )}
          {item.status === 'ready' && (
            <View style={styles.actionsRow}>
              <Pressable onPress={() => router.push({ pathname: '/repairs/bill', params: { itemId: id } } as any)} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="show-deliver-form">
                <Ionicons name="cart-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Bill Repair</Text>
              </Pressable>
            </View>
          )}
          {item.status === 'with_karigar' && (
            <View style={styles.actionsRow}>
              <Pressable onPress={() => router.push({ pathname: '/repairs/item/receive', params: { itemId: id } } as any)} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="show-receive-form">
                <Ionicons name="arrow-undo-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Receive from Karigar</Text>
              </Pressable>
            </View>
          )}
          {item.status === 'delivered' && (
            <View style={[styles.actionsRow, { marginBottom: spacing.lg }]}>
              <Pressable onPress={() => printThermal('bill')} disabled={thermalPrinting} style={[styles.actionBtn, styles.actionBtnPrimary, { flex: 1 }]} testID="print-bill-btn">
                {thermalPrinting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Print</Text></>}
              </Pressable>
              <Pressable onPress={() => printPdf('bill')} disabled={printing} style={[styles.actionBtn, { flex: 1 }]} testID="view-bill-btn">
                {printing ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>PDF</Text></>}
              </Pressable>
              {hasRight('repair_bill', 'edit') && (
                <Pressable onPress={() => router.push({ pathname: '/repairs/bill', params: { itemId: id } } as any)} style={[styles.actionBtn, { flex: 1 }]} testID="edit-bill-btn">
                  <Ionicons name="pencil-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Edit</Text>
                </Pressable>
              )}
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
                  {canEdit && (canEditRepair || canDeleteRepair) && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {canEditRepair && (
                        <Pressable onPress={() => editTxn(h)} style={styles.smallIconBtn} hitSlop={8} testID={`edit-txn-${h.id}`}>
                          <Ionicons name="pencil-outline" size={14} color={colors.onSurfaceSecondary} />
                        </Pressable>
                      )}
                      {canDeleteRepair && (
                        <Pressable onPress={() => deleteTxn(h)} style={[styles.smallIconBtn, styles.smallIconBtnDanger]} hitSlop={8} testID={`delete-txn-${h.id}`}>
                          <Ionicons name="trash-outline" size={14} color={colors.onError} />
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
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
  editIconBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, marginLeft: spacing.sm,
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
  deleteWideBtn: { flex: 0, backgroundColor: colors.error, borderColor: colors.onError },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm, lineHeight: 17 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  inputLocked: { opacity: 0.5 },
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
