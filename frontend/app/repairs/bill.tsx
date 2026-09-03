import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, RefreshControl, Image,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { confirmAction } from '@/src/utils/confirm';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { DateField } from '@/src/components/DateField';
import { REPAIR_STATUS_LABEL, repairStatusColors, RepairItemStatus } from '@/src/utils/repairStatus';
import { istDate, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: RepairItemStatus; gross_weight: number;
  created_at: string; due_date: string | null; karigar_name: string | null; created_by?: string;
  labour_charge: number; customer_adjustment?: number;
  fine_weight_diff?: number | null; weight_diff?: number | null;
  current_issue_weight?: number | null; process_loss?: number | null;
  billed_amount: number | null; payment_mode: string | null; delivered_at?: string | null;
  delivered_by?: string | null;
  bill_labour_charge?: number | null; bill_material_adjustment?: number | null;
  bill_extra_charges?: number | null; bill_extra_charges_note?: string | null;
  bill_previous_balance?: number | null; final_photo?: string | null;
  bill_weight_rate?: number | null; bill_value_add?: number | null;
};

type Txn = {
  id: string; direction: 'issue' | 'receive'; weight: number; note: string; slip_photo?: string;
  process_loss?: number; wastage_weight?: number; recv_purity?: number;
  labour_amount?: number; pay_cash?: number; pay_metal_weight?: number; pay_metal_value?: number;
  recv_cash?: number; recv_metal_weight?: number;
};

type Mode = 'list' | 'pick' | 'form' | 'close';
type BillFilterKey = 'all' | 'ready' | 'pending_delivery' | 'delivered';

const BILL_FILTERS: { key: BillFilterKey; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'ready', label: 'Pending to Bill', icon: 'pricetag-outline' },
  { key: 'pending_delivery', label: 'Pending Delivery', icon: 'time-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'checkmark-done-outline' },
];
const billFilterQuery = (f: BillFilterKey) => (f === 'all' ? 'ready,pending_delivery,delivered' : f);
const BILL_FILTER_KEYS = new Set(BILL_FILTERS.map((f) => f.key));
// "All" and "Delivered" both include every delivered tag ever billed — an
// unbounded, ever-growing fetch. Nobody scrolls a billing queue by year, so
// bound it to the last 90 days by default (a specific old tag is still
// reachable by its own detail screen, e.g. from the customer's history).
const billFromDate = (f: BillFilterKey) => {
  if (f !== 'all' && f !== 'delivered') return null;
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
};

function round3(n: number) { return Math.round(n * 1000) / 1000; }

export default function RepairBillScreen() {
  const { itemId: routeItemId, filter: routeFilter, mode: routeMode } = useLocalSearchParams<{ itemId?: string; filter?: string; mode?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { hasRight, user } = useAuth();
  const canEditBill = hasRight('repairs', 'edit');
  const canDeleteBill = hasRight('repairs', 'delete');
  const canEditReceive = hasRight('repairs', 'edit');

  const [mode, setMode] = useState<Mode>(routeItemId ? 'form' : 'list');
  const initialFilter = (routeFilter && BILL_FILTER_KEYS.has(routeFilter as BillFilterKey) ? routeFilter : 'ready') as BillFilterKey;
  const [filter, setFilter] = useState<BillFilterKey>(initialFilter);
  const [bills, setBills] = useState<Item[]>([]);
  const [readyItems, setReadyItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Item | null>(null);
  const [closeItem, setCloseItem] = useState<Item | null>(null);
  const [closeDate, setCloseDate] = useState('');
  const [closeBy, setCloseBy] = useState('');
  const [loading, setLoading] = useState(!!routeItemId);
  const [refreshing, setRefreshing] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  // Loss Wt / Received (g) — editable directly on this form for a not-yet-
  // billed tag (prefilled from the karigar receive record, but no longer
  // locked to it). lastTxnId/lastTxn hold the underlying receive transaction
  // so a correction can be persisted back to it (preserving every other
  // field — labour/cash/metal settlement — untouched) right before the bill
  // is created.
  const [lossWeightStr, setLossWeightStr] = useState('');
  const [receivedWeightStr, setReceivedWeightStr] = useState('');
  const [lastTxnId, setLastTxnId] = useState('');
  const [lastTxn, setLastTxn] = useState<Txn | null>(null);

  // Bill form fields
  const [billLabour, setBillLabour] = useState('');
  const [billExtra, setBillExtra] = useState('');
  const [billExtraNote, setBillExtraNote] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [weightRate, setWeightRate] = useState('');
  const [prevBalance, setPrevBalance] = useState('');
  const [valueAdd, setValueAdd] = useState('');
  const [finalPhoto, setFinalPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  // Rate x billable weight is how the Total is normally derived, but an
  // already-billed item's rate/value-add breakdown was never persisted —
  // only the resulting ₹ amount. Editing an existing bill without a rate
  // entered falls back to this manually-editable total, pre-filled from what
  // was actually billed.
  const [materialAdjManual, setMaterialAdjManual] = useState('');
  // Editing an already-billed tag — whether it's fully delivered or still
  // pending delivery — vs. creating a fresh bill for a 'ready' tag. The
  // backend allows correcting or deleting a bill in either of those two
  // billed states (PUT/DELETE .../bill both accept pending_delivery too).
  const isEditingBill = picked?.status === 'delivered' || picked?.status === 'pending_delivery';
  // Same one-shot auto-fallback pattern as the Repair list: if the default
  // "Pending to Bill" tab is empty the first time this screen opens, jump to
  // "Pending Delivery" instead of showing a dead end — but only once, and
  // never when the user explicitly picked a tab (route param, or tapped one
  // themselves — see the guard on that path below).
  const triedFallbackRef = useRef(!!routeFilter);

  const loadBills = useCallback(async (f: BillFilterKey) => {
    try {
      const fromDate = billFromDate(f);
      const path = `/repair-items?status=${billFilterQuery(f)}${fromDate ? `&from_date=${fromDate}` : ''}`;
      const res = await api.get<Item[]>(path);
      if (f === 'ready' && res.length === 0 && !triedFallbackRef.current) {
        triedFallbackRef.current = true;
        setFilter('pending_delivery');
        return; // the filter-change effect below reloads for the new tab
      }
      setBills(res);
      setLoading(false); setRefreshing(false);
    } catch (_e) { setBills([]); setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (mode === 'list') loadBills(filter); }, [loadBills, mode, filter]));

  const openCloseForm = (it: Item) => {
    setCloseItem(it);
    setCloseDate(todayIST());
    setCloseBy(user?.name || '');
    setMode('close');
  };

  const submitClose = async () => {
    if (submittingRef.current || !closeItem) return;
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${closeItem.id}/close-delivery`, {
        delivered_at: closeDate || null, delivered_by: closeBy || null,
      });
      if (routeItemId) { router.replace(`/repairs/item/${routeItemId}` as any); return; }
      setCloseItem(null); setMode('list'); setLoading(true);
      await loadBills(filter);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const pickItem = async (item: Item) => {
    setPicked(item);
    if (item.status === 'delivered' || item.status === 'pending_delivery') {
      // Re-opening an existing bill for correction (whether it's already
      // been picked up or is still pending delivery — the backend allows
      // editing/deleting a bill in either state) — prefill from what was
      // actually billed rather than the item's live (possibly since-changed) fields.
      setBillLabour(String(item.bill_labour_charge ?? item.labour_charge ?? 0));
      setBillExtra(item.bill_extra_charges ? String(item.bill_extra_charges) : '');
      setBillExtraNote(item.bill_extra_charges_note || '');
      setPaymentMode(item.payment_mode || 'cash');
      setWeightRate(item.bill_weight_rate ? String(item.bill_weight_rate) : '');
      setPrevBalance(item.bill_previous_balance ? String(item.bill_previous_balance) : '');
      setValueAdd(item.bill_value_add ? String(item.bill_value_add) : '');
      setMaterialAdjManual(item.bill_material_adjustment ? String(item.bill_material_adjustment) : '');
      // The list endpoint no longer ships intake_photo/final_photo (they're
      // stripped to keep list loads fast) — fetch this one item's full
      // record to get the actual final photo for the edit form.
      setFinalPhoto('');
      try {
        const res = await api.get<{ item: Item }>(`/repair-items/${item.id}`);
        setFinalPhoto(res.item.final_photo || '');
      } catch { /* ignore — form still works without the photo prefilled */ }
    } else {
      setBillLabour(String(item.labour_charge || 0));
      setBillExtra(''); setBillExtraNote(''); setPaymentMode('cash'); setWeightRate(''); setPrevBalance(''); setValueAdd(''); setFinalPhoto('');
      setMaterialAdjManual('');
      setLossWeightStr(String(item.process_loss ?? 0));
      setReceivedWeightStr(String((item.current_issue_weight || 0) + (item.weight_diff || 0)));
      setLastTxnId(''); setLastTxn(null);
      try {
        const res = await api.get<{ item: Item; history: Txn[] }>(`/repair-items/${item.id}`);
        const last = [...res.history].reverse().find((h) => h.direction === 'receive');
        if (last) { setLastTxnId(last.id); setLastTxn(last); }
      } catch { /* ignore — weight fields stay editable, just won't persist a karigar-side correction */ }
    }
    setMode('form');
  };

  const cardPress = (b: Item) => {
    if (b.status === 'ready') pickItem(b);
    else if (b.status === 'pending_delivery') openCloseForm(b);
    else router.push(`/repairs/item/${b.id}` as any);
  };

  const openPicker = async () => {
    setMode('pick');
    setLoading(true);
    try { setReadyItems(await api.get<Item[]>('/repair-items?status=ready')); }
    catch (_e) { setReadyItems([]); }
    finally { setLoading(false); }
  };

  // Deep-linked straight into the form for one item (e.g. from the tag detail
  // screen's "Bill Repair" / "Close Delivery" / "Edit Bill" buttons) — skip
  // the list/pick steps entirely. A pending_delivery tag defaults to the
  // Close Delivery form (the common case — confirming pickup), unless the
  // caller explicitly asked to edit the bill instead (?mode=edit, used by
  // the tag detail screen's separate "Edit Bill" button for that status).
  useFocusEffect(useCallback(() => {
    if (!routeItemId || picked || closeItem) return;
    setLoading(true);
    api.get<{ item: Item }>(`/repair-items/${routeItemId}`)
      .then((res) => (res.item.status === 'pending_delivery' && routeMode !== 'edit' ? openCloseForm(res.item) : pickItem(res.item)))
      .catch(() => notify('Failed', 'Could not load this tag.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeItemId, routeMode, picked, closeItem]));

  const issuedWeight = picked?.current_issue_weight || 0;
  // Loss Wt / Received (g) are editable right on this form while the tag is
  // still not-yet-billed (see the loss/receivedWeightStr inputs below) —
  // once a bill exists the underlying receive transaction is locked
  // server-side, so those fall back to whatever was actually recorded.
  const canEditWeights = !isEditingBill && canEditReceive;
  const receivedWeight = canEditWeights ? (parseFloat(receivedWeightStr) || 0) : issuedWeight + (picked?.weight_diff || 0);
  const lossWeight = canEditWeights ? (parseFloat(lossWeightStr) || 0) : (picked?.process_loss || 0);
  // New Wt = Issue − Loss − Received (gross grams, not fine) — positive when
  // less metal came back than expected once loss is forgiven, i.e. the
  // customer's item lost material during repair.
  const weightChange = round3(issuedWeight - lossWeight - receivedWeight);
  const valueAddNum = parseFloat(valueAdd) || 0;
  // Billing direction is the opposite of New Wt's sign: the item is the
  // customer's own gold, so if it came back lighter than expected, that
  // missing weight is credited back to them (not charged) — the shop
  // recovers the shortfall from the karigar separately, via the karigar
  // ledger. If it came back heavier (extra material used), that's charged.
  // Value Add (solder, sizing, etc. genuinely added) is always a charge on
  // top, regardless of which way the weight moved.
  const billableWeightChange = round3(-weightChange + valueAddNum);
  const rateNum = parseFloat(weightRate) || 0;
  // Once a rate is entered, it drives the total as usual. Until then — mainly
  // when correcting an old bill whose rate/value-add breakdown was never
  // stored — the total is whatever was typed into the manual field.
  const weightCharge = rateNum > 0
    ? Math.round(billableWeightChange * rateNum * 100) / 100
    : Math.round((parseFloat(materialAdjManual) || 0) * 100) / 100;

  const prevBalanceNum = parseFloat(prevBalance) || 0;
  const billTotal = prevBalanceNum + (parseFloat(billLabour) || 0) + weightCharge + (parseFloat(billExtra) || 0);

  const createBill = async (andPrint: boolean = false) => {
    if (submittingRef.current || !picked) return;
    // billTotal can legitimately be negative now — a credit back to the
    // customer when the item's weight decreased (see New Wt above). Only
    // block on a genuinely broken number, not on sign.
    if (Number.isNaN(billTotal)) { notify('Invalid', 'Check the amounts entered — the total is not a valid number.'); return; }
    if (canEditWeights && lastTxnId && (!receivedWeightStr || receivedWeight <= 0)) {
      notify('Invalid', 'Received weight must be greater than 0.'); return;
    }
    submittingRef.current = true; setBusy(true);
    try {
      // Loss Wt / Received were editable above — persist any correction to
      // the underlying karigar receive transaction first, preserving every
      // other field of that transaction (labour/cash/metal settlement)
      // untouched, so the karigar ledger and this bill's weight math always
      // agree. Safe to send even when nothing changed (idempotent).
      if (canEditWeights && lastTxnId && lastTxn) {
        await api.put(`/repair-items/${picked.id}/transactions/${lastTxnId}`, {
          weight: receivedWeight,
          process_loss: lossWeight,
          note: lastTxn.note || '',
          slip_photo: lastTxn.slip_photo || '',
          wastage_weight: lastTxn.wastage_weight || 0,
          purity_override: lastTxn.recv_purity || undefined,
          labour_amount: lastTxn.labour_amount || 0,
          pay_cash: lastTxn.pay_cash || 0,
          pay_metal_weight: lastTxn.pay_metal_weight || 0,
          recv_cash: lastTxn.recv_cash || 0,
          recv_metal_weight: lastTxn.recv_metal_weight || 0,
        });
      }
    } catch (e: any) { setBusy(false); submittingRef.current = false; notify('Failed', e?.detail || 'Could not save the weight correction.'); return; }
    const payload = {
      labour_charge: parseFloat(billLabour) || 0, material_adjustment: weightCharge,
      extra_charges: parseFloat(billExtra) || 0, extra_charges_note: billExtraNote,
      previous_balance: prevBalanceNum,
      payment_mode: paymentMode, note: '', final_photo: finalPhoto,
      weight_rate: rateNum, value_add: valueAddNum,
    };
    try {
      if (isEditingBill) {
        await api.put(`/repair-items/${picked.id}/bill`, payload);
      } else {
        await api.post(`/repair-items/${picked.id}/deliver`, payload);
      }
      if (andPrint) { await printThermalBill(picked); }
      if (routeItemId) { router.replace(`/repairs/item/${routeItemId}` as any); return; }
      setPicked(null); setMode('list'); setLoading(true);
      await loadBills(filter);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
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
      // Deleting now only happens from inside the edit-bill form — exit back
      // out to the list (or wherever this form was deep-linked from) since
      // there's no bill left here to keep editing.
      if (routeItemId) { router.replace(`/repairs/item/${routeItemId}` as any); return; }
      setPicked(null); setMode('list'); setLoading(true);
      await loadBills(filter);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
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
        notify('Ready', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { notify('Failed', e?.message || 'Please try again'); }
    finally { setPrintingId(''); }
  };

  const [thermalPrintingId, setThermalPrintingId] = useState('');
  // Sends straight to the WiFi thermal printer configured in Store Settings
  // (raw ESC/POS over TCP) instead of generating a PDF.
  const printThermalBill = async (item: Item) => {
    setThermalPrintingId(item.id);
    try {
      await api.post(`/repair-items/${item.id}/bill/print`, {});
    } catch (e: any) { notify('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
    finally { setThermalPrintingId(''); }
  };

  const headerTitle = mode === 'list' ? 'Repair Bills' : mode === 'pick' ? 'Select Item to Bill' : mode === 'close' ? 'Close Delivery' : isEditingBill ? 'Edit Bill' : 'Create Bill';
  const onBack = () => {
    if (mode === 'close' && !routeItemId) { setCloseItem(null); setMode('list'); return; }
    if (mode === 'form' && !routeItemId) { setMode(isEditingBill ? 'list' : 'pick'); return; }
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
          {BILL_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => { setLoading(true); setFilter(f.key); }}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              testID={`bill-filter-${f.key}`}
            >
              <Ionicons name={f.icon} size={13} color={filter === f.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {mode === 'list' && !!billFromDate(filter) && (
        <Text style={styles.dateBoundHint}>Showing the last 90 days</Text>
      )}

      {mode === 'list' && (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBills(filter); }} tintColor={colors.brandPrimary} />}
        >
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : bills.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>Nothing here — tap + to bill a ready item</Text>
            </View>
          ) : bills.map((b) => {
            const sc = repairStatusColors(b.status, colors);
            // Same fields as the Repair list card's meta line, so a tag
            // looks the same whether you're looking at it there or here.
            const repairMetaBits = [
              `Created ${istDate(b.created_at)}`,
              b.due_date ? `Due ${b.due_date}` : null,
              b.karigar_name || null,
              b.created_by ? `by ${b.created_by}` : null,
            ].filter(Boolean);
            const billMetaBits = [
              b.billed_amount != null ? `₹${b.billed_amount.toFixed(0)}` : null,
              b.payment_mode || null,
              b.delivered_at ? `delivered ${istDate(b.delivered_at)}` : null,
            ].filter(Boolean);
            return (
              <View key={b.id} style={styles.billCard} testID={`bill-${b.id}`}>
                <Pressable style={{ flex: 1 }} onPress={() => cardPress(b)}>
                  <View style={styles.billTopRow}>
                    <Text style={styles.billName} numberOfLines={1}>{b.customer_name}</Text>
                    <View style={[styles.statusBadgeSm, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                      <Text style={[styles.statusTextSm, { color: sc.fg }]}>{REPAIR_STATUS_LABEL[b.status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.billItem} numberOfLines={1}>{b.description}</Text>
                  <View style={styles.billSubRow}>
                    <Text style={styles.billTag} numberOfLines={1}>{b.item_code}</Text>
                    <Text style={styles.billWeight}>{b.gross_weight.toFixed(3)}g</Text>
                  </View>
                  <Text style={styles.billMeta}>{repairMetaBits.join('  ·  ')}</Text>
                  {billMetaBits.length > 0 && (
                    <Text style={styles.billMeta}>{billMetaBits.join('  ·  ')}</Text>
                  )}
                </Pressable>
                {(b.status === 'delivered' || b.status === 'pending_delivery') && canEditBill && (
                  <Pressable onPress={() => pickItem(b)} style={styles.editBtn} testID={`edit-bill-${b.id}`}>
                    <Ionicons name="pencil-outline" size={16} color={colors.onSurfaceSecondary} />
                  </Pressable>
                )}
              </View>
            );
          })}
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

      {mode === 'close' && !closeItem && (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      )}

      {mode === 'close' && closeItem && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{closeItem.item_code} · {closeItem.customer_name}</Text>
              <Text style={styles.cMeta}>{closeItem.description}{closeItem.billed_amount != null ? ` · Billed ₹${closeItem.billed_amount.toFixed(0)}` : ''}</Text>
            </View>
            <Text style={styles.hint}>Record when the customer actually picked up the item and who handed it over.</Text>
            <DateField label="Date Delivered" value={closeDate} onChange={setCloseDate} testID="close-delivered-at" />
            <Text style={styles.label}>Delivered By</Text>
            <TextInput testID="close-delivered-by" value={closeBy} onChangeText={setCloseBy} placeholder="Who handed over the item" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Pressable onPress={submitClose} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="close-delivery-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Close Delivery</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {mode === 'form' && !picked && (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      )}

      {mode === 'form' && picked && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{picked.item_code} · {picked.customer_name}</Text>
              <Text style={styles.cMeta}>{picked.description}</Text>
            </View>

            {/* Print/delete only ever apply to an already-delivered bill —
                moved here off the list row (which only shows Edit now) so
                they're a deliberate in-context action, not row-clutter. */}
            {isEditingBill && (
              <View style={styles.formActionRow}>
                <Pressable onPress={() => printBill(picked)} disabled={printingId === picked.id} style={styles.formActionBtn} testID="form-print-pdf-btn">
                  {printingId === picked.id ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} />}
                  <Text style={styles.formActionBtnText}>Print PDF</Text>
                </Pressable>
                <Pressable onPress={() => printThermalBill(picked)} disabled={thermalPrintingId === picked.id} style={[styles.formActionBtn, styles.formActionBtnPrimary]} testID="form-print-thermal-btn">
                  {thermalPrintingId === picked.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} />}
                  <Text style={styles.formActionBtnTextPrimary}>Print Receipt</Text>
                </Pressable>
                {canDeleteBill && (
                  <Pressable onPress={() => confirmDeleteBill(picked)} disabled={deletingId === picked.id} style={styles.formActionBtnDanger} testID="form-delete-bill-btn">
                    {deletingId === picked.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
                  </Pressable>
                )}
              </View>
            )}

            {/* Issue − Loss − Received = New Wt */}
            <View style={styles.formulaRow} testID="bill-field-grid">
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>Issue (g)</Text>
                <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{issuedWeight.toFixed(3)}</Text></View>
              </View>
              <Text style={styles.opText}>−</Text>
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>Loss Wt (g)</Text>
                {canEditWeights ? (
                  <TextInput testID="bill-loss-weight" value={lossWeightStr} onChangeText={(v) => setLossWeightStr(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
                ) : (
                  <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{lossWeight.toFixed(3)}</Text></View>
                )}
              </View>
              <Text style={styles.opText}>−</Text>
              <View style={styles.fieldColFlex}>
                <Text style={[styles.label, styles.labelHighlight]}>Received (g)</Text>
                {canEditWeights ? (
                  <TextInput testID="bill-received-weight" value={receivedWeightStr} onChangeText={(v) => setReceivedWeightStr(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={[styles.input, styles.inputHighlight]} />
                ) : (
                  <View style={[styles.readonlyBox, styles.inputHighlight]}><Text style={styles.readonlyBoxText}>{receivedWeight.toFixed(3)}</Text></View>
                )}
              </View>
            </View>
            {canEditWeights && (
              <Text style={styles.hint}>Loss Wt / Received are pulled from the karigar receive record — edit here if they need correcting.</Text>
            )}

            {/* New Wt · Value Add · Rate · Total */}
            <View style={[styles.fieldGrid, { marginTop: spacing.sm }]} testID="bill-charge-grid">
              <View style={styles.fieldCol}>
                <Text style={styles.label}>New Wt (g)</Text>
                <View style={styles.readonlyBox}>
                  <Text style={[styles.readonlyBoxText, weightChange !== 0 ? { color: weightChange > 0 ? colors.onSuccess : colors.onWarning } : null]}>
                    {weightChange >= 0 ? '+' : ''}{weightChange.toFixed(3)}
                  </Text>
                </View>
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Value Add (g)</Text>
                <TextInput testID="value-add" value={valueAdd} onChangeText={(v) => setValueAdd(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Rate (₹/g)</Text>
                <TextInput testID="weight-rate" value={weightRate} onChangeText={(v) => setWeightRate(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldCol}>
                <Text style={styles.label}>Total (₹)</Text>
                {rateNum > 0 ? (
                  <View style={styles.readonlyBox}>
                    <Text style={[styles.readonlyBoxText, weightCharge !== 0 ? { color: weightCharge < 0 ? colors.onSuccess : colors.onSurface } : null]}>
                      {weightCharge < 0 ? `Credit ₹${Math.abs(weightCharge).toFixed(0)}` : `₹${weightCharge.toFixed(0)}`}
                    </Text>
                  </View>
                ) : (
                  <TextInput testID="material-adj-manual" value={materialAdjManual} onChangeText={(v) => setMaterialAdjManual(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
                )}
              </View>
            </View>
            <Text style={styles.hint}>Positive New Wt = weight decreased, credited back to the customer (the shop recovers this from the karigar separately). Negative = extra material came back, charged to them.</Text>
            {rateNum === 0 && (
              <Text style={styles.hint}>No rate entered — Total is entered directly{isEditingBill ? ' (pre-filled from what was billed)' : ''}. Enter a rate above to compute it from New Wt instead.</Text>
            )}
            {!!valueAddNum && (
              <Text style={styles.hint}>Billable weight change: {billableWeightChange >= 0 ? '+' : ''}{billableWeightChange.toFixed(3)}g (−New Wt {weightChange >= 0 ? '+' : ''}{(-weightChange).toFixed(3)}g + value add {valueAddNum.toFixed(3)}g)</Text>
            )}

            <View style={styles.formulaRow}>
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>Previous Balance (₹)</Text>
                <TextInput testID="bill-prev-balance" value={prevBalance} onChangeText={(v) => setPrevBalance(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>Labour Charge (₹)</Text>
                <TextInput testID="bill-labour" value={billLabour} onChangeText={(v) => setBillLabour(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>Extra Charges (₹)</Text>
                <TextInput testID="bill-extra" value={billExtra} onChangeText={(v) => setBillExtra(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
            {(parseFloat(billExtra) || 0) > 0 && (
              <TextInput testID="bill-extra-note" value={billExtraNote} onChangeText={setBillExtraNote} placeholder="What's this extra charge for?" placeholderTextColor={colors.mutedText} style={[styles.input, { marginTop: spacing.sm }]} />
            )}

            <View style={styles.totalRow} testID="bill-total">
              <Text style={styles.totalLabel}>{billTotal < 0 ? 'G. Total — Refund Due' : 'G. Total'}</Text>
              <Text style={[styles.totalValue, billTotal < 0 && { color: colors.onSuccess }]}>
                {billTotal < 0 ? `₹${Math.abs(billTotal).toFixed(0)} credit` : `₹${billTotal.toFixed(0)}`}
              </Text>
            </View>
            {billTotal < 0 && (
              <Text style={styles.hint}>This bill nets to a credit — the customer is owed ₹{Math.abs(billTotal).toFixed(0)} back.</Text>
            )}

            <Text style={styles.label}>Payment mode</Text>
            <View style={styles.chipRow}>
              {(['cash', 'upi', 'card'] as const).map((m) => (
                <Pressable key={m} onPress={() => setPaymentMode(m)} style={[styles.chip, paymentMode === m && styles.chipActive]} testID={`payment-${m}`}>
                  <Text style={[styles.chipText, paymentMode === m && styles.chipTextActive]}>{m.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.photoLineRow}>
              <Text style={[styles.label, { marginTop: 0, flex: 1 }]}>Final Photo (optional)</Text>
              {finalPhoto ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable onPress={() => setCameraOpen(true)} testID="bill-retake-photo">
                    <Image source={{ uri: finalPhoto }} style={styles.photoThumbSmall} />
                  </Pressable>
                  <Pressable onPress={() => setFinalPhoto('')} style={styles.delBtnSmall} hitSlop={10} testID="bill-remove-photo">
                    <Ionicons name="close" size={12} color={colors.onError} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setCameraOpen(true)} style={styles.cameraBtn} testID="bill-add-photo">
                  <Ionicons name="camera-outline" size={18} color={colors.onSurfaceSecondary} />
                </Pressable>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable onPress={() => createBill(false)} disabled={busy} style={[styles.saveBtn, { flex: 1, marginTop: 0 }, busy && { opacity: 0.6 }]} testID="create-bill-btn">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{isEditingBill ? 'Save Changes' : 'Create Bill'}</Text>}
              </Pressable>
              <Pressable onPress={() => createBill(true)} disabled={busy} style={[styles.saveBtnSecondary, busy && { opacity: 0.6 }]} testID="create-bill-print-btn">
                {busy ? <ActivityIndicator color={colors.brandPrimary} /> : (
                  <>
                    <Ionicons name="print-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.saveBtnSecondaryText}>Save & Print</Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Final Photo"
        onClose={() => setCameraOpen(false)}
        onCapture={async (photo) => { setFinalPhoto(photo); setCameraOpen(false); }}
      />
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

  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 2 },
  dateBoundHint: { color: colors.mutedText, fontSize: 11, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.onBrandPrimary },
  statusBadgeSm: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusTextSm: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },

  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },

  // Bills list row — larger tile, same customer/item/tag+weight ordering as
  // the Repair list for a consistent scan pattern across both screens.
  billCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: 14, marginBottom: 10,
  },
  billTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  billName: { flex: 1, color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  billItem: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600', marginTop: 4 },
  billSubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: 4 },
  billTag: { flex: 1, color: colors.mutedText, fontSize: 12.5 },
  billWeight: { color: colors.brandSecondary, fontSize: 14, fontWeight: '800' },
  billMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 6 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  // Everything but the (optional) trailing Edit button lives in one big
  // Pressable so the whole row is tappable, not just a sliver of text next
  // to a wall of icon buttons — that's what was making rows unreadable.
  itemRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { flex: 1, color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  editBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  printBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
  },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error,
  },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  formActionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  formActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 11,
  },
  formActionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  formActionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  formActionBtnTextPrimary: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  formActionBtnDanger: {
    width: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error, borderRadius: radius.md,
  },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldCol: { flexBasis: '21%', flexGrow: 1 },
  // Issue − Loss − Received = New Wt — three boxes joined by inline
  // operators, matching the hand-drawn layout.
  formulaRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  fieldColFlex: { flex: 1, minWidth: 0 },
  opText: { color: colors.mutedText, fontSize: 15, fontWeight: '700', marginBottom: 12, paddingHorizontal: 1 },
  readonlyBox: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 10,
  },
  readonlyBoxText: { color: colors.onSurface, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  labelHighlight: { color: colors.brandPrimary, fontWeight: '800' },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  inputHighlight: { borderColor: colors.brandPrimary, borderWidth: 2, backgroundColor: colors.brandTertiary },
  photoLineRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  cameraBtn: {
    width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  photoThumbSmall: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  delBtnSmall: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
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
  saveBtnSecondary: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandPrimary, paddingVertical: 13,
  },
  saveBtnSecondaryText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 14 },
});
