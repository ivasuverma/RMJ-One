import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { displayDateOnly, todayIST } from '@/src/utils/datetime';
import { useSubmitGuard } from '@/src/hooks/use-submit-guard';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { DateField } from '@/src/components/DateField';
import { Input, Button, Skeleton, ErrorState, useToast } from '@/src/components/ui';
import { confirmAction } from '@/src/utils/confirm';

type Entry = {
  id: string; date: string; particulars: string; fine_delta: number; amount_delta: number;
  running_fine: number; running_amount: number; source?: string; created_by?: string;
};
type Detail = {
  account: { id: string; name: string; phone?: string; type_id?: string; note?: string; active?: boolean; opening_fine: number; opening_amount: number };
  type_name: string; fine_balance: number; amount_balance: number; entries: Entry[];
};
type AccountType = { id: string; name: string; key: string };

const fmtFine = (n: number) => `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(3)} g`;
const fmtAmt = (n: number) => `${n >= 0 ? '' : '−'}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const signFine = (n: number) => (n ? `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}` : '—');
const signAmt = (n: number) => (n ? `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n)).toLocaleString('en-IN')}` : '—');

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const guard = useSubmitGuard();

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Edit-account form
  const [types, setTypes] = useState<AccountType[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eTypeId, setETypeId] = useState('');
  const [eNote, setENote] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Add-entry form
  const [date, setDate] = useState(todayIST());
  const [particulars, setParticulars] = useState('');
  const [fine, setFine] = useState('');
  const [amount, setAmount] = useState('');
  // Direction: does this entry increase what they owe the shop (+) or what the
  // shop owes them (−)? Applied to whichever of fine/amount is filled.
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get<Detail>(`/accounts/${id}`));
    } catch (e: any) {
      setError(e?.detail || 'Failed to load account');
    } finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useFocusEffect(useCallback(() => { api.get<AccountType[]>('/account-types').then(setTypes).catch(() => {}); }, []));

  const openEdit = () => {
    if (!data) return;
    setEName(data.account.name);
    setEPhone(data.account.phone || '');
    setETypeId(data.account.type_id || '');
    setENote(data.account.note || '');
    setEditOpen(true);
  };

  const saveEdit = () => guard(async () => {
    if (!eName.trim()) { toast.error('Name is required'); return; }
    if (ePhone.replace(/\D/g, '').length < 7) { toast.error('Mobile number is required'); return; }
    setEditBusy(true);
    try {
      await api.put(`/accounts/${id}`, { name: eName.trim(), phone: ePhone.trim(), type_id: eTypeId || undefined, note: eNote });
      setEditOpen(false);
      toast.success('Account updated');
      await load();
    } catch (e: any) {
      toast.error(e?.detail || 'Could not update account');
    } finally { setEditBusy(false); }
  });

  const deactivate = () => {
    confirmAction('Deactivate account?', 'It will be hidden from the ledger list but its history is kept. You can recreate it later.', 'Deactivate', async () => {
      try {
        await api.put(`/accounts/${id}`, { active: false });
        toast.success('Account deactivated');
        router.back();
      } catch (e: any) { toast.error(e?.detail || 'Could not deactivate'); }
    });
  };

  const deleteAccount = () => {
    confirmAction('Delete account?', 'Permanently removes this account. Only possible when it has no ledger entries — otherwise deactivate it instead.', 'Delete', async () => {
      try {
        await api.del(`/accounts/${id}`);
        toast.success('Account deleted');
        router.back();
      } catch (e: any) { toast.error(e?.detail || 'Could not delete — try Deactivate instead'); }
    });
  };

  const openAdd = () => {
    setDate(todayIST()); setParticulars(''); setFine(''); setAmount(''); setDirection('debit');
    setAddOpen(true);
  };

  const submitEntry = () => guard(async () => {
    const f = parseFloat(fine) || 0;
    const a = parseFloat(amount) || 0;
    if (f === 0 && a === 0) { toast.error('Enter a gold and/or cash movement'); return; }
    if (!particulars.trim()) { toast.error('Enter particulars'); return; }
    const sign = direction === 'debit' ? 1 : -1;
    setBusy(true);
    try {
      await api.post(`/accounts/${id}/entries`, {
        date, particulars: particulars.trim(),
        fine_delta: sign * Math.abs(f), amount_delta: sign * Math.abs(a),
      });
      setAddOpen(false);
      toast.success('Entry added');
      await load();
    } catch (e: any) {
      toast.error(e?.detail || 'Could not add entry');
    } finally { setBusy(false); }
  });

  const deleteEntry = (e: Entry) => {
    confirmAction('Delete entry?', `Remove "${e.particulars}" from this account's ledger. This cannot be undone.`, 'Delete', async () => {
      try {
        await api.del(`/accounts/${id}/entries/${e.id}`);
        toast.success('Entry deleted');
        await load();
      } catch (err: any) { toast.error(err?.detail || 'Could not delete'); }
    });
  };

  const settleBalance = () => {
    if (!data) return;
    confirmAction(
      'Settle balance?',
      `Post an entry that clears this account to zero (currently ${fmtFine(data.fine_balance)} gold, ${fmtAmt(data.amount_balance)}). Any new repair/sample/wage activity after this starts fresh.`,
      'Settle',
      async () => {
        try { await api.post(`/accounts/${id}/settle`, {}); toast.success('Balance settled'); await load(); }
        catch (e: any) { toast.error(e?.detail || 'Could not settle'); }
      },
    );
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/accounts/${id}/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        toast.success('Statement generated on server');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not export');
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="account-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{data?.account.name || 'Account'}</Text>
          {!!data && <Text style={styles.subtitle}>{data.type_name}{data.account.phone ? ` · ${data.account.phone}` : ''}</Text>}
        </View>
        <Pressable onPress={openEdit} disabled={!data} style={styles.iconBtn} testID="account-edit-btn" hitSlop={12}>
          <Ionicons name="create-outline" size={19} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={exportPdf} disabled={exporting} style={styles.iconBtn} testID="account-export-pdf" hitSlop={12}>
          <Ionicons name={exporting ? 'hourglass-outline' : 'download-outline'} size={19} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width="100%" height={80} radius={radius.md} />
          <Skeleton width="100%" height={200} radius={radius.md} />
        </View>
      ) : error ? (
        <View style={{ padding: spacing.lg }}><ErrorState message={error} onRetry={load} testID="account-error" /></View>
      ) : data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {/* Two balance cards — fine and amount, each with its own direction. */}
          <View style={styles.balRow}>
            <BalanceCard label="Fine balance" value={fmtFine(data.fine_balance)} direction={dirWord(data.fine_balance)} tint={colors.brandSecondary} />
            <BalanceCard label="Amount balance" value={fmtAmt(data.amount_balance)} direction={dirWord(data.amount_balance)} tint={data.amount_balance >= 0 ? colors.onSuccess : colors.onWarning} />
          </View>

          {(Math.abs(data.fine_balance) > 0.0005 || Math.abs(data.amount_balance) > 0.005) && (
            <Pressable onPress={settleBalance} style={styles.settleBtn} testID="account-settle-btn">
              <Ionicons name="checkmark-done-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.settleBtnText}>Settle / clear balance</Text>
            </Pressable>
          )}

          {/* Statement — two independent columns (Fine g / Amount ₹). */}
          <View style={styles.stmtHeaderRow}>
            <Text style={[styles.stmtH, styles.colDate]}>Date</Text>
            <Text style={[styles.stmtH, styles.colPart]}>Particulars</Text>
            <Text style={[styles.stmtH, styles.colNum]}>Fine ±</Text>
            <Text style={[styles.stmtH, styles.colNum]}>Amount ±</Text>
          </View>

          <View style={styles.openingRow}>
            <Text style={[styles.openingText, styles.colDate]}>—</Text>
            <Text style={[styles.openingText, styles.colPart]}>Opening balance</Text>
            <Text style={[styles.openingText, styles.colNum]}>{data.account.opening_fine ? data.account.opening_fine.toFixed(3) : '—'}</Text>
            <Text style={[styles.openingText, styles.colNum]}>{data.account.opening_amount ? Math.round(data.account.opening_amount).toLocaleString('en-IN') : '—'}</Text>
          </View>

          {data.entries.length === 0 ? (
            <Text style={styles.noEntries}>No entries yet. Add the first one below.</Text>
          ) : data.entries.map((e) => (
            <Pressable
              key={e.id}
              onLongPress={() => (!e.source || e.source === 'manual') && deleteEntry(e)}
              style={styles.stmtRow}
              testID={`account-entry-${e.id}`}
            >
              <Text style={[styles.cellDate, styles.colDate]}>{displayDateOnly(e.date)}</Text>
              <View style={styles.colPart}>
                <Text style={styles.cellPart} numberOfLines={2}>{e.particulars}</Text>
                <View style={styles.metaRow}>
                  {!!e.source && e.source !== 'manual' && (
                    <View style={styles.srcTag}><Text style={styles.srcTagText}>{e.source === 'karigar' ? 'Karigar ledger' : e.source === 'repair' ? 'Repair' : e.source}</Text></View>
                  )}
                  <Text style={styles.cellRun}>bal {e.running_fine.toFixed(3)}g · ₹{Math.round(e.running_amount).toLocaleString('en-IN')}</Text>
                </View>
              </View>
              <Text style={[styles.cellNum, styles.colNum, { color: e.fine_delta > 0 ? colors.onSuccess : e.fine_delta < 0 ? colors.onWarning : colors.mutedText }]}>{signFine(e.fine_delta)}</Text>
              <Text style={[styles.cellNum, styles.colNum, { color: e.amount_delta > 0 ? colors.onSuccess : e.amount_delta < 0 ? colors.onWarning : colors.mutedText }]}>{signAmt(e.amount_delta)}</Text>
            </Pressable>
          ))}
          {data.entries.length > 0 && <Text style={styles.longPressHint}>Long-press a manual entry to delete it.</Text>}
        </ScrollView>
      ) : null}

      {!!data && (
        <Pressable onPress={openAdd} style={styles.fab} testID="account-add-entry-btn">
          <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
        </Pressable>
      )}

      {/* Add-entry modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAddOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Add ledger entry</Text>

              <View style={styles.dirRow}>
                {(['debit', 'credit'] as const).map((d) => (
                  <Pressable key={d} onPress={() => setDirection(d)} style={[styles.dirChip, direction === d && styles.dirChipActive]} testID={`entry-dir-${d}`}>
                    <Text style={[styles.dirText, direction === d && styles.dirTextActive]}>
                      {d === 'debit' ? 'They owe shop (+)' : 'Shop owes them (−)'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.formLabel}>Date</Text>
              <DateField value={date} onChange={setDate} testID="entry-date" />
              <Input label="Particulars" value={particulars} onChangeText={setParticulars} required placeholder="e.g. Gold issued, Cash received" testID="entry-particulars" />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input label="Fine (g)" value={fine} onChangeText={(v) => setFine(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" testID="entry-fine" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Amount (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" testID="entry-amount" />
                </View>
              </View>

              <View style={{ height: spacing.md }} />
              <Button label="Add entry" onPress={submitEntry} loading={busy} leftIcon="checkmark" testID="entry-save" />
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Edit-account modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setEditOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Edit account</Text>

              <Text style={styles.formLabel}>Type</Text>
              <View style={styles.etypeRow}>
                {types.map((t) => (
                  <Pressable key={t.id} onPress={() => setETypeId(t.id)} style={[styles.etypeChip, eTypeId === t.id && styles.dirChipActive]} testID={`edit-type-${t.key}`}>
                    <Text style={[styles.dirText, eTypeId === t.id && styles.dirTextActive]}>{t.name}</Text>
                  </Pressable>
                ))}
              </View>

              <Input label="Name" value={eName} onChangeText={setEName} required placeholder="Account name" testID="edit-name" />
              <Input label="Mobile" value={ePhone} onChangeText={setEPhone} required keyboardType="phone-pad" placeholder="Mobile number" testID="edit-phone" />
              <Input label="Note (optional)" value={eNote} onChangeText={setENote} placeholder="Anything worth remembering" testID="edit-note" />

              <View style={{ height: spacing.md }} />
              <Button label="Save changes" onPress={saveEdit} loading={editBusy} leftIcon="checkmark" testID="edit-save" />

              <View style={styles.dangerRow}>
                <Pressable onPress={deactivate} style={styles.dangerBtn} testID="account-deactivate">
                  <Ionicons name="eye-off-outline" size={17} color={colors.onWarning} />
                  <Text style={[styles.dangerText, { color: colors.onWarning }]}>Deactivate</Text>
                </Pressable>
                <Pressable onPress={deleteAccount} style={styles.dangerBtn} testID="account-delete">
                  <Ionicons name="trash-outline" size={17} color={colors.onError} />
                  <Text style={[styles.dangerText, { color: colors.onError }]}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function dirWord(v: number): string {
  if (v > 0) return 'due to shop';
  if (v < 0) return 'shop owes';
  return 'settled';
}

function BalanceCard({ label, value, direction, tint }: { label: string; value: string; direction: string; tint: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.balCard}>
      <Text style={styles.balLabel}>{label}</Text>
      <Text style={[styles.balValue, { color: tint }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.balDir}>{direction}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display },
  subtitle: { color: colors.mutedText, fontSize: 12, marginTop: 1 },

  balRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  balCard: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  balLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  balValue: { fontSize: 20, fontWeight: '800', fontFamily: fonts.display, marginTop: 4 },
  balDir: { color: colors.mutedText, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

  stmtHeaderRow: {
    flexDirection: 'row', alignItems: 'center', paddingBottom: 6,
    borderBottomWidth: 2, borderBottomColor: colors.border,
  },
  stmtH: { color: colors.onSurfaceSecondary, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase' },
  colDate: { width: 62 },
  colPart: { flex: 1, minWidth: 0, paddingRight: 6 },
  colNum: { width: 68, textAlign: 'right' },

  openingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  openingText: { color: colors.onSurfaceTertiary, fontSize: 11.5, fontStyle: 'italic' },

  stmtRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider },
  cellDate: { color: colors.onSurfaceSecondary, fontSize: 11.5 },
  cellPart: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  cellRun: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
  settleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.md,
  },
  settleBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  srcTag: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  srcTagText: { color: colors.brandSecondary, fontSize: 9, fontWeight: '700' },
  cellNum: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },

  noEntries: { color: colors.mutedText, fontSize: 13, textAlign: 'center', paddingVertical: spacing.xl },
  longPressHint: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.md },

  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700', fontFamily: fonts.display, marginBottom: spacing.md },
  dirRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  dirChip: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dirChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dirText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  dirTextActive: { color: colors.onBrandPrimary },
  formLabel: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  etypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  etypeChip: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dangerRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  dangerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.borderStrong,
  },
  dangerText: { fontSize: 14, fontWeight: '700' },
  twoCol: { flexDirection: 'row', gap: spacing.sm },
});
