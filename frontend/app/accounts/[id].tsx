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
  account: { id: string; name: string; phone?: string; opening_fine: number; opening_amount: number; note?: string };
  type_name: string; fine_balance: number; amount_balance: number; entries: Entry[];
};

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
                <Text style={styles.cellRun}>bal {e.running_fine.toFixed(3)}g · ₹{Math.round(e.running_amount).toLocaleString('en-IN')}</Text>
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
  twoCol: { flexDirection: 'row', gap: spacing.sm },
});
