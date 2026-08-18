import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { DateField } from '@/src/components/DateField';
import { displayDateOnlyWithWeekday, localDateStr, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

type EntryType = 'received' | 'paid';
type Entry = {
  id: string; date: string; counter_id: string; type: EntryType; amount: number; name: string; note?: string;
  created_at: string; created_by?: string; updated_at?: string; updated_by?: string;
  linked_entry_id?: string | null; transfer_counter_id?: string | null;
};
type DayData = {
  date: string; counter_id: string; counter_name: string; opening_balance: number; entries: Entry[];
  total_received: number; total_paid: number; closing_balance: number;
};
type Counter = { id: string; name: string; opening_balance: number; active: boolean; created_at: string; created_by?: string };
type Emp = { id: string; name: string; employee_code: string; designation?: string };
type QuickName = { id: string; name: string };

type Mode = 'view' | 'form' | 'settings';

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export default function CashBookScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, hasRight } = useAuth();
  const canEdit = hasRight('cash_book', 'edit');
  const canDelete = hasRight('cash_book', 'delete');
  const isOwner = user?.role === 'owner';

  const [date, setDate] = useState(todayIST());
  const [day, setDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  // Counters — each is its own cash book with its own entries/running
  // balance. counterId is whichever one is currently selected.
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterId, setCounterId] = useState('');
  const [countersLoading, setCountersLoading] = useState(true);
  // null = counter list view (inside Manage mode); non-null = add/edit form for one counter
  const [counterForm, setCounterForm] = useState<{ id: string | null; name: string; opening_balance: string } | null>(null);

  // Entry form
  const [editing, setEditing] = useState<Entry | null>(null);
  const [entryType, setEntryType] = useState<EntryType>('received');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  // Transfer between two counters — only settable when creating a new entry
  // (the backend locks the link once created; see the hint shown when
  // editing an already-linked entry instead).
  const [isTransfer, setIsTransfer] = useState(false);
  const [transferCounterId, setTransferCounterId] = useState('');
  // Employee picker (Paid entries only — e.g. salary/advance paid out) and
  // reusable Name/Description presets (either entry type).
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [quickNames, setQuickNames] = useState<QuickName[]>([]);
  const [addingQuickName, setAddingQuickName] = useState(false);
  const [newQuickName, setNewQuickName] = useState('');

  const loadCounters = useCallback(async (selectId?: string) => {
    try {
      const res = await api.get<Counter[]>('/cashbook/counters');
      setCounters(res);
      setCounterId((prev) => {
        if (selectId && res.some((c) => c.id === selectId)) return selectId;
        if (prev && res.some((c) => c.id === prev)) return prev;
        return res[0]?.id || '';
      });
    } catch (_e) { setCounters([]); }
    finally { setCountersLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { loadCounters(); }, [loadCounters]));

  const loadRefs = useCallback(async () => {
    try { setEmployees(await api.get<Emp[]>('/employees?status=active')); } catch { /* ignore */ }
    try { setQuickNames(await api.get<QuickName[]>('/cashbook/quick-names')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { loadRefs(); }, [loadRefs]));

  const load = useCallback(async (d: string, cid: string) => {
    if (!cid) { setDay(null); setLoading(false); setRefreshing(false); return; }
    try {
      const res = await api.get<DayData>(`/cashbook/day?date=${d}&counter_id=${cid}`);
      setDay(res);
    } catch (_e) { setDay(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    if (mode !== 'view' || countersLoading) return;
    setLoading(true); load(date, counterId);
  }, [load, date, counterId, mode, countersLoading]));

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(localDateStr(d));
  };

  const openAdd = (t: EntryType) => {
    setEditing(null); setEntryType(t); setAmount(''); setName(''); setNote('');
    setIsTransfer(false); setTransferCounterId('');
    setEmpPickerOpen(false); setAddingQuickName(false); setNewQuickName('');
    setMode('form');
  };
  const openEdit = (e: Entry) => {
    setEditing(e); setEntryType(e.type); setAmount(String(e.amount)); setName(e.name); setNote(e.note || '');
    setIsTransfer(false); setTransferCounterId('');
    setEmpPickerOpen(false); setAddingQuickName(false); setNewQuickName('');
    setMode('form');
  };

  const saveQuickName = async () => {
    const n = newQuickName.trim();
    if (!n) return;
    try {
      const created = await api.post<QuickName>('/cashbook/quick-names', { name: n });
      setQuickNames((prev) => (prev.some((q) => q.id === created.id) ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name))));
      setName(created.name);
      setNewQuickName(''); setAddingQuickName(false);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
  };

  // Picking (or switching) the transfer counter refreshes the suggested
  // Name to match, since that's what most people will want — still fully
  // editable afterward.
  const pickTransferCounter = (cid: string) => {
    setTransferCounterId(cid);
    const other = counters.find((c) => c.id === cid);
    if (other) setName(`Transfer ${entryType === 'paid' ? 'to' : 'from'} ${other.name}`);
  };

  const submitEntry = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Enter an amount greater than 0'); return; }
    if (!name.trim()) { Alert.alert('Invalid', 'Enter a name / description'); return; }
    if (!counterId) { Alert.alert('No counter selected', 'Add a Cash Book counter first.'); return; }
    if (isTransfer && !transferCounterId) { Alert.alert('Invalid', 'Pick the other counter for this transfer'); return; }
    setBusy(true);
    const payload: any = { date, counter_id: counterId, type: entryType, amount: amt, name: name.trim(), note };
    if (isTransfer && !editing) payload.transfer_counter_id = transferCounterId;
    try {
      if (editing) {
        await api.put(`/cashbook/entries/${editing.id}`, payload);
      } else {
        await api.post('/cashbook/entries', payload);
      }
      setMode('view'); setLoading(true);
      await load(date, counterId);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const confirmDeleteEntry = (e: Entry) => {
    const linkedCounterName = e.linked_entry_id ? counters.find((c) => c.id === e.transfer_counter_id)?.name : null;
    confirmAction(
      'Delete entry?',
      linkedCounterName
        ? `Remove "${e.name}" (${fmtINR(e.amount)}) — this will also remove the matching transfer entry in ${linkedCounterName}. This cannot be undone.`
        : `Remove "${e.name}" (${fmtINR(e.amount)}) from this day's cash book. This cannot be undone.`,
      'Delete',
      () => doDelete(e),
    );
  };
  const doDelete = async (e: Entry) => {
    setDeletingId(e.id);
    try {
      await api.del(`/cashbook/entries/${e.id}`);
      setMode('view'); setLoading(true);
      await load(date, counterId);
    } catch (err: any) { Alert.alert('Failed', err?.detail || 'Please try again'); }
    finally { setDeletingId(''); }
  };

  const openManageCounters = () => { setCounterForm(null); setMode('settings'); };
  const saveCounter = async () => {
    if (!counterForm) return;
    if (!counterForm.name.trim()) { Alert.alert('Invalid', 'Enter a name'); return; }
    setBusy(true);
    try {
      let selectId: string | undefined = counterForm.id || undefined;
      if (counterForm.id) {
        await api.put(`/cashbook/counters/${counterForm.id}`, {
          name: counterForm.name.trim(), opening_balance: parseFloat(counterForm.opening_balance) || 0,
        });
      } else {
        const created = await api.post<Counter>('/cashbook/counters', {
          name: counterForm.name.trim(), opening_balance: parseFloat(counterForm.opening_balance) || 0,
        });
        selectId = created.id;
      }
      setCounterForm(null);
      await loadCounters(selectId);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };
  const deactivateCounter = (c: Counter) => {
    confirmAction(
      'Deactivate counter?',
      `"${c.name}" will no longer appear in the counter list. Its recorded entries are kept, not deleted.`,
      'Deactivate',
      async () => {
        setBusy(true);
        try {
          await api.put(`/cashbook/counters/${c.id}`, { active: false });
          setCounterForm(null);
          await loadCounters();
        } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
        finally { setBusy(false); }
      },
    );
  };

  const received = day?.entries.filter((e) => e.type === 'received') || [];
  const paid = day?.entries.filter((e) => e.type === 'paid') || [];
  const isToday = date === todayIST();

  const renderEntry = (e: Entry, amountColor: string) => (
    <Pressable key={e.id} disabled={!canEdit} onPress={() => openEdit(e)} style={styles.entryRow} testID={`cashbook-entry-${e.id}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!!e.linked_entry_id && <Ionicons name="swap-horizontal-outline" size={11} color={colors.brandSecondary} />}
          <Text style={styles.entryName} numberOfLines={2}>{e.name}</Text>
        </View>
        {!!e.note && <Text style={styles.entryNote} numberOfLines={2}>{e.note}</Text>}
      </View>
      <Text style={[styles.entryAmount, { color: amountColor }]}>{fmtINR(e.amount)}</Text>
    </Pressable>
  );

  const headerTitle = mode === 'settings' ? (counterForm ? (counterForm.id ? 'Edit Counter' : 'Add Counter') : 'Cash Book Counters') : mode === 'form' ? (editing ? 'Edit Entry' : entryType === 'received' ? 'Cash Received' : 'Cash Paid') : 'Cash Book';
  const onBack = () => {
    if (mode === 'settings' && counterForm) { setCounterForm(null); return; }
    if (mode !== 'view') { setMode('view'); return; }
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cashbook-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{headerTitle}</Text>
        {mode === 'view' && isOwner ? (
          <Pressable onPress={openManageCounters} style={styles.iconBtn} testID="cashbook-settings-btn" hitSlop={12}>
            <Ionicons name="settings-outline" size={19} color={colors.onSurface} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      {mode === 'view' && (
        <>
          {counters.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.counterScroll} contentContainerStyle={styles.counterChipsRow}>
              {counters.map((c) => (
                <Pressable key={c.id} onPress={() => setCounterId(c.id)} style={[styles.counterChip, counterId === c.id && styles.counterChipActive]} testID={`cashbook-counter-${c.id}`}>
                  <Text style={[styles.counterChipText, counterId === c.id && styles.counterChipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.dayNav}>
            <Pressable onPress={() => shiftDay(-1)} style={styles.navBtn} testID="cashbook-prev-day" hitSlop={10}>
              <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <DateField value={date} onChange={setDate} testID="cashbook-date-field" />
            </View>
            <Pressable onPress={() => shiftDay(1)} style={styles.navBtn} testID="cashbook-next-day" hitSlop={10}>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
            </Pressable>
            {!isToday && (
              <Pressable onPress={() => setDate(todayIST())} style={styles.todayChip} testID="cashbook-today-btn">
                <Text style={styles.todayChipText}>Today</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.dayLabel}>
            {displayDateOnlyWithWeekday(date)}{counters.length === 1 ? ` · ${counters[0].name}` : ''}
          </Text>

          {countersLoading || loading ? (
            <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : counters.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>
                {isOwner ? 'No Cash Book counters yet — add one to start recording entries.' : 'No Cash Book counters have been set up yet.'}
              </Text>
              {isOwner && (
                <Pressable onPress={() => { setMode('settings'); setCounterForm({ id: null, name: '', opening_balance: '0' }); }} style={styles.addCounterBtn} testID="cashbook-add-first-counter">
                  <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.addCounterBtnText}>Add Counter</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(date, counterId); }} tintColor={colors.brandPrimary} />}
            >
              <View style={styles.openingRow} testID="cashbook-opening">
                <Text style={styles.openingLabel}>Opening Balance</Text>
                <Text style={styles.openingValue}>{fmtINR(day?.opening_balance || 0)}</Text>
              </View>

              <View style={styles.columnsRow}>
                <View style={styles.column}>
                  <View style={[styles.colHeader, { borderColor: colors.brandSecondary }]}>
                    <Ionicons name="trending-up" size={14} color={colors.onSuccess} />
                    <Text style={[styles.colHeaderText, { color: colors.onSuccess }]}>Received</Text>
                  </View>
                  {received.length === 0 ? (
                    <Text style={styles.colEmpty}>No entries</Text>
                  ) : received.map((e) => renderEntry(e, colors.onSuccess))}
                  <View style={styles.colTotalRow}>
                    <Text style={styles.colTotalLabel}>Total</Text>
                    <Text style={[styles.colTotalValue, { color: colors.onSuccess }]}>{fmtINR(day?.total_received || 0)}</Text>
                  </View>
                </View>

                <View style={styles.column}>
                  <View style={[styles.colHeader, { borderColor: colors.error }]}>
                    <Ionicons name="trending-down" size={14} color={colors.onError} />
                    <Text style={[styles.colHeaderText, { color: colors.onError }]}>Paid</Text>
                  </View>
                  {paid.length === 0 ? (
                    <Text style={styles.colEmpty}>No entries</Text>
                  ) : paid.map((e) => renderEntry(e, colors.onError))}
                  <View style={styles.colTotalRow}>
                    <Text style={styles.colTotalLabel}>Total</Text>
                    <Text style={[styles.colTotalValue, { color: colors.onError }]}>{fmtINR(day?.total_paid || 0)}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.counterBalRow} testID="cashbook-counter-bal">
                <Text style={styles.counterBalLabel}>Counter Bal (Closing)</Text>
                <Text style={styles.counterBalValue}>{fmtINR(day?.closing_balance || 0)}</Text>
              </View>
            </ScrollView>
          )}

          {counters.length > 0 && (
            <View style={styles.fabRow}>
              <Pressable onPress={() => openAdd('received')} style={[styles.fab, { backgroundColor: colors.brandPrimary }]} testID="cashbook-add-received">
                <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.fabText}>Received</Text>
              </Pressable>
              <Pressable onPress={() => openAdd('paid')} style={[styles.fab, styles.fabSecondary]} testID="cashbook-add-paid">
                <Ionicons name="add" size={18} color={colors.onSurface} />
                <Text style={[styles.fabText, { color: colors.onSurface }]}>Paid</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {mode === 'form' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            {!!editing && (
              <Text style={styles.hint}>
                Added by {editing.created_by || 'unknown'}
                {editing.updated_by ? ` · last edited by ${editing.updated_by}` : ''}
              </Text>
            )}
            {!!editing?.linked_entry_id && (
              <View style={styles.transferInfoBox} testID="cashbook-linked-info">
                <Ionicons name="swap-horizontal-outline" size={14} color={colors.brandSecondary} />
                <Text style={styles.transferInfoText}>
                  Linked to a transfer with {counters.find((c) => c.id === editing.transfer_counter_id)?.name || 'another counter'} —
                  amount/date/note changes update both sides; deleting removes both.
                </Text>
              </View>
            )}
            {counters.length > 1 && (
              <>
                <Text style={styles.label}>Counter</Text>
                <View style={styles.chipRow}>
                  {counters.map((c) => (
                    <Pressable key={c.id} onPress={() => setCounterId(c.id)} style={[styles.typeChip, counterId === c.id && styles.typeChipReceived]} testID={`cashbook-form-counter-${c.id}`}>
                      <Text style={[styles.typeChipText, counterId === c.id && styles.typeChipTextActive]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <View style={styles.chipRow}>
              {(['received', 'paid'] as const).map((t) => (
                <Pressable key={t} onPress={() => setEntryType(t)} style={[styles.typeChip, entryType === t && (t === 'received' ? styles.typeChipReceived : styles.typeChipPaid)]} testID={`cashbook-type-${t}`}>
                  <Text style={[styles.typeChipText, entryType === t && styles.typeChipTextActive]}>{t === 'received' ? 'Received' : 'Paid'}</Text>
                </Pressable>
              ))}
            </View>

            {!editing && counters.length > 1 && (
              <>
                <Pressable onPress={() => { setIsTransfer((v) => !v); setTransferCounterId(''); }} style={styles.transferToggleRow} testID="cashbook-transfer-toggle">
                  <View style={[styles.checkbox, isTransfer && styles.checkboxOn]}>
                    {isTransfer && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}
                  </View>
                  <Text style={styles.transferToggleText}>This is a transfer to/from another counter</Text>
                </Pressable>
                {isTransfer && (
                  <>
                    <Text style={styles.label}>{entryType === 'paid' ? 'Transfer to' : 'Transfer from'}</Text>
                    <View style={styles.chipRow}>
                      {counters.filter((c) => c.id !== counterId).map((c) => (
                        <Pressable key={c.id} onPress={() => pickTransferCounter(c.id)} style={[styles.typeChip, transferCounterId === c.id && styles.typeChipReceived]} testID={`cashbook-transfer-counter-${c.id}`}>
                          <Text style={[styles.typeChipText, transferCounterId === c.id && styles.typeChipTextActive]}>{c.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.hint}>
                      {entryType === 'paid'
                        ? `This counter records a paid entry; ${transferCounterId ? counters.find((c) => c.id === transferCounterId)?.name : 'the other counter'} automatically gets a matching received entry.`
                        : `This counter records a received entry; ${transferCounterId ? counters.find((c) => c.id === transferCounterId)?.name : 'the other counter'} automatically gets a matching paid entry.`}
                    </Text>
                  </>
                )}
              </>
            )}

            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput testID="cashbook-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} autoFocus />

            {entryType === 'paid' && !isTransfer && employees.length > 0 && (
              <>
                <Text style={styles.label}>Employee (optional)</Text>
                <Pressable onPress={() => setEmpPickerOpen((v) => !v)} style={styles.picker} testID="cashbook-employee-picker-toggle">
                  <Text style={styles.pickerPlaceholder}>Pick an employee to fill the name</Text>
                  <Ionicons name={empPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                </Pressable>
                {empPickerOpen && (
                  <View style={styles.pickerList} testID="cashbook-employee-picker-list">
                    <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                      {employees.map((emp) => (
                        <Pressable key={emp.id} onPress={() => { setName(emp.name); setEmpPickerOpen(false); }} style={styles.pickerRow} testID={`cashbook-emp-opt-${emp.id}`}>
                          <Text style={styles.pickerRowName}>{emp.name}</Text>
                          <Text style={styles.pickerRowMeta}>{emp.designation || emp.employee_code}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </>
            )}

            {!isTransfer && (quickNames.length > 0 || addingQuickName) && (
              <>
                <Text style={styles.label}>Quick Picks</Text>
                <View style={styles.chipRow}>
                  {quickNames.map((q) => (
                    <Pressable key={q.id} onPress={() => setName(q.name)} style={styles.quickChip} testID={`cashbook-quickname-${q.id}`}>
                      <Text style={styles.quickChipText}>{q.name}</Text>
                    </Pressable>
                  ))}
                  {!addingQuickName && (
                    <Pressable onPress={() => setAddingQuickName(true)} style={[styles.quickChip, styles.quickChipAdd]} testID="cashbook-add-quickname">
                      <Ionicons name="add" size={13} color={colors.brandSecondary} />
                      <Text style={[styles.quickChipText, { color: colors.brandSecondary }]}>New</Text>
                    </Pressable>
                  )}
                </View>
                {addingQuickName && (
                  <View style={styles.quickAddRow}>
                    <TextInput
                      testID="cashbook-new-quickname"
                      value={newQuickName}
                      onChangeText={setNewQuickName}
                      placeholder="e.g. Milk, Tea, Electricity"
                      placeholderTextColor={colors.mutedText}
                      style={[styles.input, { flex: 1 }]}
                      autoFocus
                    />
                    <Pressable onPress={saveQuickName} style={styles.quickAddSaveBtn} testID="cashbook-save-quickname">
                      <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} />
                    </Pressable>
                    <Pressable onPress={() => { setAddingQuickName(false); setNewQuickName(''); }} style={styles.quickAddCancelBtn} testID="cashbook-cancel-quickname">
                      <Ionicons name="close" size={18} color={colors.onSurfaceSecondary} />
                    </Pressable>
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>Name / Description</Text>
            <TextInput testID="cashbook-name" value={name} onChangeText={setName} placeholder="e.g. Ajay Sood advance, Milk" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="cashbook-note" value={note} onChangeText={setNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Pressable onPress={submitEntry} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="cashbook-save-entry">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{editing ? 'Save Changes' : 'Add Entry'}</Text>}
            </Pressable>

            {!!editing && canDelete && (
              <Pressable
                onPress={() => confirmDeleteEntry(editing)}
                disabled={deletingId === editing.id}
                style={[styles.deleteEntryBtn, deletingId === editing.id && { opacity: 0.6 }]}
                testID="cashbook-delete-entry"
              >
                {deletingId === editing.id ? <ActivityIndicator size="small" color={colors.onError} /> : (
                  <>
                    <Ionicons name="trash-outline" size={15} color={colors.onError} />
                    <Text style={styles.deleteEntryBtnText}>Delete Entry</Text>
                  </>
                )}
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {mode === 'settings' && (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          {counterForm ? (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput testID="counter-name" value={counterForm.name} onChangeText={(v) => setCounterForm((f) => (f ? { ...f, name: v } : f))} placeholder="e.g. Counter 1, Showroom" placeholderTextColor={colors.mutedText} style={styles.input} autoFocus />

              <Text style={styles.label}>Opening Balance (₹)</Text>
              <TextInput testID="counter-opening" value={counterForm.opening_balance} onChangeText={(v) => setCounterForm((f) => (f ? { ...f, opening_balance: v.replace(/[^0-9.]/g, '') } : f))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.hint}>
                {counterForm.id
                  ? 'This is a one-time base — every day after the first still carries forward automatically from entries.'
                  : 'One-time starting balance for this counter — used only as the base for its very first day. Every day after that carries forward automatically.'}
              </Text>

              <Pressable onPress={saveCounter} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="counter-form-save">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{counterForm.id ? 'Save Changes' : 'Add Counter'}</Text>}
              </Pressable>

              {!!counterForm.id && (
                <Pressable
                  onPress={() => {
                    const c = counters.find((x) => x.id === counterForm.id);
                    if (c) deactivateCounter(c);
                  }}
                  style={styles.deactivateBtn}
                  testID="counter-form-deactivate"
                >
                  <Text style={styles.deactivateBtnText}>Deactivate this counter</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.hint}>Each counter keeps its own entries and its own running balance — use this for separate cash registers or tills.</Text>
              {counters.map((c) => (
                <Pressable key={c.id} onPress={() => setCounterForm({ id: c.id, name: c.name, opening_balance: String(c.opening_balance) })} style={styles.counterManageRow} testID={`counter-manage-${c.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.entryName}>{c.name}</Text>
                    <Text style={styles.entryNote}>Opening balance {fmtINR(c.opening_balance)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
                </Pressable>
              ))}
              <Pressable onPress={() => setCounterForm({ id: null, name: '', opening_balance: '0' })} style={styles.addCounterBtn} testID="add-counter-btn">
                <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.addCounterBtnText}>Add Counter</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  counterScroll: { flexGrow: 0, flexShrink: 0 },
  counterChipsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 2 },
  counterChip: {
    alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  counterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  counterChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  counterChipTextActive: { color: colors.onBrandPrimary },

  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  navBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  todayChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brand },
  todayChipText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  dayLabel: { color: colors.onSurfaceSecondary, fontSize: 12, paddingHorizontal: spacing.lg, marginTop: 6 },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center' },

  openingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.md,
  },
  openingLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  openingValue: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },

  columnsRow: { flexDirection: 'row', gap: spacing.sm },
  column: { flex: 1, minWidth: 0 },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: 2, paddingBottom: 6, marginBottom: spacing.sm },
  colHeaderText: { fontSize: 12.5, fontWeight: '800', textTransform: 'uppercase' },
  colEmpty: { color: colors.mutedText, fontSize: 11.5, paddingVertical: spacing.sm },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 9, marginBottom: 6,
  },
  entryName: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700' },
  entryNote: { color: colors.mutedText, fontSize: 10.5, marginTop: 2 },
  entryAmount: { fontSize: 12.5, fontWeight: '800' },
  colTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8, marginTop: 4,
  },
  colTotalLabel: { color: colors.onSurfaceSecondary, fontSize: 11.5, fontWeight: '700' },
  colTotalValue: { fontSize: 13, fontWeight: '800' },

  counterBalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, marginTop: spacing.lg,
  },
  counterBalLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  counterBalValue: { color: colors.onSurface, fontSize: 17, fontWeight: '800' },

  fabRow: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg,
    flexDirection: 'row', gap: spacing.sm,
  },
  fab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: radius.pill, paddingVertical: 13,
  },
  fabSecondary: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  fabText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  typeChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  typeChipReceived: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeChipPaid: { backgroundColor: colors.error, borderColor: colors.error },
  typeChipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  typeChipTextActive: { color: colors.onBrandPrimary },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  transferInfoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: colors.brandTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand,
    padding: spacing.sm, marginBottom: spacing.md,
  },
  transferInfoText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 11.5, lineHeight: 16 },
  transferToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, marginBottom: spacing.sm },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  transferToggleText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },

  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 13 },
  pickerList: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.sm, padding: spacing.xs,
  },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 11 },

  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  quickChipAdd: { borderColor: colors.brand, borderStyle: 'dashed' },
  quickChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  quickAddRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  quickAddSaveBtn: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  quickAddCancelBtn: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  deleteEntryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, paddingVertical: 13, marginTop: spacing.sm,
  },
  deleteEntryBtnText: { color: colors.onError, fontWeight: '700', fontSize: 13 },

  counterManageRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  addCounterBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.sm,
  },
  addCounterBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  deactivateBtn: { alignItems: 'center', paddingVertical: 12, marginTop: spacing.sm },
  deactivateBtnText: { color: colors.onError, fontWeight: '700', fontSize: 12 },
});
