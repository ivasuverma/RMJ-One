import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };
type Entry = {
  id: string; type: 'gold_out' | 'gold_in' | 'wastage' | 'labour_payable' | 'payment';
  weight: number | null; amount: number | null; item_id?: string | null; item_code: string | null; note: string; created_at: string; created_by: string;
};

const ENTRY_LABEL: Record<Entry['type'], string> = {
  gold_out: 'Gold issued', gold_in: 'Gold received', wastage: 'Wastage adjustment', labour_payable: 'Labour payable', payment: 'Payment made',
};
const ENTRY_ICON: Record<Entry['type'], any> = {
  gold_out: 'arrow-redo-outline', gold_in: 'arrow-undo-outline', wastage: 'trending-down-outline', labour_payable: 'cash-outline', payment: 'checkmark-circle-outline',
};

export default function KarigarLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigar, setKarigar] = useState<Karigar | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weightBalance, setWeightBalance] = useState(0);
  const [amountDue, setAmountDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState<null | 'labour_payable' | 'payment'>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ karigar: Karigar; entries: Entry[]; weight_balance: number; amount_due: number }>(`/karigars/${id}/ledger`);
      setKarigar(res.karigar); setEntries(res.entries); setWeightBalance(res.weight_balance); setAmountDue(res.amount_due);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (submittingRef.current || !showForm) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Amount must be greater than 0'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post(`/karigars/${id}/ledger`, { type: showForm, amount: amt, note });
      setAmount(''); setNote(''); setShowForm(null);
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const removeEntry = (e: Entry) => {
    confirmAction(
      'Delete entry?',
      `Remove this ${ENTRY_LABEL[e.type].toLowerCase()} entry? This cannot be undone.`,
      'Delete',
      async () => {
        setDeletingId(e.id);
        try { await api.del(`/karigars/${id}/ledger/${e.id}`); await load(); }
        catch (err: any) { Alert.alert('Failed', err?.detail || 'Could not delete this entry.'); }
        finally { setDeletingId(''); }
      },
    );
  };

  if (loading || !karigar) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigar-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{karigar.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{weightBalance.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Gold with karigar</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, amountDue > 0 && { color: colors.onWarning }]}>₹{amountDue.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Amount due</Text>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable onPress={() => setShowForm(showForm === 'labour_payable' ? null : 'labour_payable')} style={styles.actionBtn} testID="add-labour-btn">
              <Ionicons name="cash-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Add Labour Owed</Text>
            </Pressable>
            <Pressable onPress={() => setShowForm(showForm === 'payment' ? null : 'payment')} style={[styles.actionBtn, styles.actionBtnPrimary]} testID="record-payment-btn">
              <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Record Payment</Text>
            </Pressable>
          </View>

          {showForm && (
            <View style={styles.formCard} testID="ledger-entry-form">
              <Text style={styles.label}>{showForm === 'labour_payable' ? 'Amount owed for labour (₹)' : 'Amount paid (₹)'}</Text>
              <TextInput testID="ledger-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="ledger-note" value={note} onChangeText={setNote} placeholder="Reference or reason" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable onPress={submit} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="ledger-save-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
              </Pressable>
            </View>
          )}

          <Text style={styles.section}>History · {entries.length}</Text>
          {entries.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No ledger entries yet</Text></View>
          ) : entries.map((e) => (
            <View key={e.id} style={styles.entryRow} testID={`entry-${e.id}`}>
              <View style={styles.entryIcon}><Ionicons name={ENTRY_ICON[e.type]} size={16} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>{ENTRY_LABEL[e.type]}{e.item_code ? ` · ${e.item_code}` : ''}</Text>
                <Text style={styles.entryMeta}>{e.note || '—'} · {e.created_at?.slice(0, 10)} · {e.created_by}</Text>
              </View>
              <Text style={styles.entryValue}>
                {e.weight != null ? `${e.weight.toFixed(3)}g` : e.amount != null ? `₹${Math.abs(e.amount).toFixed(0)}` : ''}
              </Text>
              {!e.item_id && (
                <Pressable onPress={() => removeEntry(e)} disabled={deletingId === e.id} style={styles.entryDelBtn} hitSlop={8} testID={`del-entry-${e.id}`}>
                  {deletingId === e.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={14} color={colors.onError} />}
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionBtnPrimaryText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryDelBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs,
  },
});
