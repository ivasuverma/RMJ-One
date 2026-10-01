import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { istTime } from '@/src/utils/datetime';
import { notify } from '@/src/utils/notify';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';

export type Closure = {
  id: string; date: string; expected: number; counted: number; difference: number; note: string;
  closed_by: string; closed_at: string;
};

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

/**
 * Close the day for one Cash Book counter: count the cash, see the difference
 * against the book, and lock the day (any difference is recorded as one
 * "Cash count difference" entry). Shows the closed state with Reopen for the owner.
 */
export function DayClose({ counterId, counterName, date, today, bookBalance, closure, canClose, isOwner, onChanged }: {
  counterId: string; counterName: string; date: string; today: string; bookBalance: number;
  closure: Closure | null | undefined; canClose: boolean; isOwner: boolean; onChanged: () => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const countedNum = Number(counted);
  const diff = counted.trim() === '' || !Number.isFinite(countedNum) ? null : Math.round((countedNum - bookBalance) * 100) / 100;

  const close = async () => {
    if (diff === null) { notify('Missing', 'Enter the cash you counted'); return; }
    setBusy(true);
    try {
      await api.post('/cashbook/close', { counter_id: counterId, date, counted: countedNum, note });
      setOpen(false); setCounted(''); setNote('');
      toast.success(diff === 0 ? 'Day closed — cash matches the book' : `Day closed — ${diff > 0 ? 'over' : 'short'} by ${inr(Math.abs(diff))}`);
      onChanged();
    } catch (e: any) { notify('Could not close the day', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const reopen = () => confirmAction(
    `Reopen ${counterName} for ${date}?`,
    'The day unlocks for changes and the count difference entry is removed. Close it again after fixing entries.',
    'Reopen',
    async () => {
      try { await api.del(`/cashbook/close/${counterId}/${date}`); toast.success('Day reopened'); onChanged(); }
      catch (e: any) { notify('Could not reopen', e?.detail || 'Please try again'); }
    },
  );

  if (closure) {
    const d = closure.difference;
    return (
      <View style={s.closed} testID="cashbook-day-closed">
        <View style={s.closedIcon}><Ionicons name="lock-closed" size={16} color={colors.onSuccess} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.closedTitle}>Day closed{d === 0 ? ' · cash matched' : ` · ${d > 0 ? 'over' : 'short'} ${inr(Math.abs(d))}`}</Text>
          <Text style={s.closedSub} numberOfLines={2}>
            Counted {inr(closure.counted)} · book {inr(closure.expected)} · by {closure.closed_by} at {istTime(closure.closed_at)}
          </Text>
        </View>
        {isOwner && (
          <Pressable onPress={reopen} style={s.reopen} hitSlop={6} testID="cashbook-reopen-day">
            <Text style={s.reopenText}>Reopen</Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (!canClose || date > today) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.85 }]} testID="cashbook-close-day">
        <Ionicons name="lock-closed-outline" size={17} color={colors.brandSecondary} />
        <Text style={s.closeText}>Close the day</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={`Close ${counterName}`} testID="cashbook-close-sheet">
        <Text style={s.hint}>Count the cash in {counterName} and enter it. Any difference is recorded, and the day is locked for changes.</Text>
        <View style={s.row}><Text style={s.lbl}>Book says</Text><Text style={s.val}>{inr(bookBalance)}</Text></View>
        <Text style={[s.lbl, { marginTop: spacing.md }]}>Cash counted</Text>
        <View style={s.inputRow}>
          <TextInput value={counted} onChangeText={(v) => setCounted(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad"
            placeholder="0" placeholderTextColor={colors.mutedText} style={s.input} testID="cashbook-counted" autoFocus />
          <Pressable onPress={() => setCounted(String(bookBalance))} style={s.match} testID="cashbook-counted-matches">
            <Text style={s.matchText}>Matches</Text>
          </Pressable>
        </View>
        {diff !== null && (
          <View style={[s.diff, { backgroundColor: diff === 0 ? colors.success : diff > 0 ? colors.info : colors.error }]} testID="cashbook-diff">
            <Text style={[s.diffText, { color: diff === 0 ? colors.onSuccess : diff > 0 ? colors.onInfo : colors.onError }]}>
              {diff === 0 ? 'Matches the book' : `${diff > 0 ? 'Over' : 'Short'} by ${inr(Math.abs(diff))}`}
            </Text>
          </View>
        )}
        <Text style={[s.lbl, { marginTop: spacing.md }]}>Note (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="e.g. ₹50 given to helper for tea" placeholderTextColor={colors.mutedText} style={s.note} testID="cashbook-close-note" />
        <Pressable onPress={close} disabled={busy} style={[s.confirm, busy && { opacity: 0.6 }]} testID="cashbook-close-confirm">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.confirmText}>Close the day</Text>}
        </Pressable>
      </Sheet>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  closeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandTertiary, backgroundColor: colors.surfaceSecondary },
  closeText: { color: colors.brandSecondary, fontSize: 15, fontWeight: '700' },
  closed: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  closedIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  closedTitle: { color: colors.onSurface, fontSize: 14.5, fontWeight: '700' },
  closedSub: { color: colors.mutedText, fontSize: 12.5, marginTop: 1 },
  reopen: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  reopenText: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  hint: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  lbl: { color: colors.onSurfaceSecondary, fontSize: 13, marginBottom: 6 },
  val: { color: colors.onSurface, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, color: colors.onSurface, fontSize: 22, fontWeight: '800', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontVariant: ['tabular-nums'] },
  match: { justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  matchText: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  diff: { marginTop: 10, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center' },
  diffText: { fontSize: 15, fontWeight: '800' },
  note: { color: colors.onSurface, fontSize: 15, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11 },
  confirm: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  confirmText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '800' },
});
