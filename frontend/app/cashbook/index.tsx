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
  id: string; date: string; type: EntryType; amount: number; name: string; note?: string;
  created_at: string; created_by?: string;
};
type DayData = {
  date: string; opening_balance: number; entries: Entry[];
  total_received: number; total_paid: number; closing_balance: number;
};

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

  // Entry form
  const [editing, setEditing] = useState<Entry | null>(null);
  const [entryType, setEntryType] = useState<EntryType>('received');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  // Owner-only opening balance settings
  const [baseOpening, setBaseOpening] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    try {
      const res = await api.get<DayData>(`/cashbook/day?date=${d}`);
      setDay(res);
    } catch (_e) { setDay(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (mode === 'view') { setLoading(true); load(date); } }, [load, date, mode]));

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(localDateStr(d));
  };

  const openAdd = (t: EntryType) => {
    setEditing(null); setEntryType(t); setAmount(''); setName(''); setNote('');
    setMode('form');
  };
  const openEdit = (e: Entry) => {
    setEditing(e); setEntryType(e.type); setAmount(String(e.amount)); setName(e.name); setNote(e.note || '');
    setMode('form');
  };

  const submitEntry = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Enter an amount greater than 0'); return; }
    if (!name.trim()) { Alert.alert('Invalid', 'Enter a name / description'); return; }
    setBusy(true);
    const payload = { date, type: entryType, amount: amt, name: name.trim(), note };
    try {
      if (editing) {
        await api.put(`/cashbook/entries/${editing.id}`, payload);
      } else {
        await api.post('/cashbook/entries', payload);
      }
      setMode('view'); setLoading(true);
      await load(date);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const confirmDeleteEntry = (e: Entry) => {
    confirmAction('Delete entry?', `Remove "${e.name}" (${fmtINR(e.amount)}) from this day's cash book. This cannot be undone.`, 'Delete', () => doDelete(e));
  };
  const doDelete = async (e: Entry) => {
    setDeletingId(e.id);
    try {
      await api.del(`/cashbook/entries/${e.id}`);
      await load(date);
    } catch (err: any) { Alert.alert('Failed', err?.detail || 'Please try again'); }
    finally { setDeletingId(''); }
  };

  const openSettings = async () => {
    setMode('settings'); setSettingsLoading(true);
    try {
      const res = await api.get<{ opening_balance: number }>('/cashbook/settings');
      setBaseOpening(String(res.opening_balance ?? 0));
    } catch (_e) { setBaseOpening('0'); }
    finally { setSettingsLoading(false); }
  };
  const saveSettings = async () => {
    setBusy(true);
    try {
      await api.put('/cashbook/settings', { opening_balance: parseFloat(baseOpening) || 0 });
      setMode('view'); setLoading(true);
      await load(date);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const received = day?.entries.filter((e) => e.type === 'received') || [];
  const paid = day?.entries.filter((e) => e.type === 'paid') || [];
  const isToday = date === todayIST();

  const headerTitle = mode === 'settings' ? 'Opening Balance' : mode === 'form' ? (editing ? 'Edit Entry' : entryType === 'received' ? 'Cash Received' : 'Cash Paid') : 'Cash Book';
  const onBack = () => {
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
          <Pressable onPress={openSettings} style={styles.iconBtn} testID="cashbook-settings-btn" hitSlop={12}>
            <Ionicons name="settings-outline" size={19} color={colors.onSurface} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      {mode === 'view' && (
        <>
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
          <Text style={styles.dayLabel}>{displayDateOnlyWithWeekday(date)}</Text>

          {loading ? (
            <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(date); }} tintColor={colors.brandPrimary} />}
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
                  ) : received.map((e) => (
                    <Pressable key={e.id} onPress={() => canEdit && openEdit(e)} style={styles.entryRow} testID={`cashbook-entry-${e.id}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.entryName} numberOfLines={2}>{e.name}</Text>
                        {!!e.note && <Text style={styles.entryNote} numberOfLines={2}>{e.note}</Text>}
                      </View>
                      <Text style={[styles.entryAmount, { color: colors.onSuccess }]}>{fmtINR(e.amount)}</Text>
                      {canDelete && (
                        <Pressable onPress={() => confirmDeleteEntry(e)} disabled={deletingId === e.id} style={styles.delIcon} hitSlop={8} testID={`cashbook-delete-${e.id}`}>
                          {deletingId === e.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={13} color={colors.mutedText} />}
                        </Pressable>
                      )}
                    </Pressable>
                  ))}
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
                  ) : paid.map((e) => (
                    <Pressable key={e.id} onPress={() => canEdit && openEdit(e)} style={styles.entryRow} testID={`cashbook-entry-${e.id}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.entryName} numberOfLines={2}>{e.name}</Text>
                        {!!e.note && <Text style={styles.entryNote} numberOfLines={2}>{e.note}</Text>}
                      </View>
                      <Text style={[styles.entryAmount, { color: colors.onError }]}>{fmtINR(e.amount)}</Text>
                      {canDelete && (
                        <Pressable onPress={() => confirmDeleteEntry(e)} disabled={deletingId === e.id} style={styles.delIcon} hitSlop={8} testID={`cashbook-delete-${e.id}`}>
                          {deletingId === e.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={13} color={colors.mutedText} />}
                        </Pressable>
                      )}
                    </Pressable>
                  ))}
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
        </>
      )}

      {mode === 'form' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.chipRow}>
              {(['received', 'paid'] as const).map((t) => (
                <Pressable key={t} onPress={() => setEntryType(t)} style={[styles.typeChip, entryType === t && (t === 'received' ? styles.typeChipReceived : styles.typeChipPaid)]} testID={`cashbook-type-${t}`}>
                  <Text style={[styles.typeChipText, entryType === t && styles.typeChipTextActive]}>{t === 'received' ? 'Received' : 'Paid'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput testID="cashbook-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} autoFocus />

            <Text style={styles.label}>Name / Description</Text>
            <TextInput testID="cashbook-name" value={name} onChangeText={setName} placeholder="e.g. Ajay Sood advance, Milk" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="cashbook-note" value={note} onChangeText={setNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Pressable onPress={submitEntry} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="cashbook-save-entry">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{editing ? 'Save Changes' : 'Add Entry'}</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {mode === 'settings' && (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.hint}>
            One-time starting cash balance — used only as the base for the very first day recorded here. Every day after that carries forward automatically from entries.
          </Text>
          {settingsLoading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 20 }} />
          ) : (
            <>
              <Text style={styles.label}>Opening Balance (₹)</Text>
              <TextInput testID="cashbook-base-opening" value={baseOpening} onChangeText={(v) => setBaseOpening(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={saveSettings} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="cashbook-save-settings">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
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

  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  navBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  todayChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brand },
  todayChipText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  dayLabel: { color: colors.onSurfaceSecondary, fontSize: 12, paddingHorizontal: spacing.lg, marginTop: 6 },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  delIcon: { padding: 2 },
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

  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
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
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
