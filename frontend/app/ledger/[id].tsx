import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, RefreshControl,
  Modal, TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

const fmtINR = (n: number) => `₹${(Math.abs(n) || 0).toLocaleString('en-IN')}`;
const fmtDate = (s?: string) => istDisplayDate(s);

const ICON: Record<string, any> = {
  advance: 'cash-outline', bonus: 'gift-outline', fine: 'warning-outline',
  deduction: 'remove-circle-outline', salary: 'wallet-outline',
  salary_earned: 'wallet-outline', salary_paid: 'checkmark-done-outline',
  joined: 'briefcase-outline', salary_revised: 'trending-up-outline',
  leave: 'calendar-outline', correction: 'create-outline', other: 'ellipse-outline',
};

// Only these types are real, editable/deletable monetary ledger entries.
// "joined", "salary", "salary_revised", etc. are milestone/system records.
const EDITABLE_TYPES = ['advance', 'bonus', 'fine', 'deduction', 'other'];

const EDIT_TYPES = [
  { key: 'advance', label: 'Advance', icon: 'cash-outline', tone: 'error' },
  { key: 'bonus', label: 'Bonus', icon: 'gift-outline', tone: 'success' },
  { key: 'fine', label: 'Fine', icon: 'warning-outline', tone: 'error' },
  { key: 'deduction', label: 'Deduction', icon: 'remove-circle-outline', tone: 'error' },
  { key: 'other', label: 'Other', icon: 'ellipse-outline', tone: 'error' },
] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function EmployeeLedger() {
  const { id, year, month, type: scopedType, label: scopedLabel } = useLocalSearchParams<{
    id: string; year?: string; month?: string; type?: string; label?: string;
  }>();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const canAdd = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'accountant';
  // Scoped mode: viewing just one type (advance/bonus/fine/deduction) within one
  // payroll month — reached by tapping a Breakdown row on the payroll screen.
  const isScoped = !!(year && month);
  const [data, setData] = useState<{ entries: any[]; closing_balance?: number; total?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      if (isScoped) {
        const q = scopedType ? `?type=${scopedType}` : '';
        setData(await api.get<any>(`/ledger/${id}/month/${year}/${month}${q}`));
      } else {
        setData(await api.get<any>(`/ledger/${id}`));
      }
    }
    catch (e: any) { setData(null); setError(e?.detail || 'Failed to load ledger'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id, isScoped, year, month, scopedType]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const headerTitle = isScoped
    ? `${scopedLabel || 'Entries'} · ${MONTHS[(parseInt(month!, 10) || 1) - 1]?.slice(0, 3)} ${year}`
    : (canAdd ? 'Employee Ledger' : 'My Ledger');

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
        {canAdd ? (
          <Pressable
            onPress={() => router.push({
              pathname: '/ledger/new',
              params: { emp: id, ...(isScoped && scopedType ? { type: scopedType } : {}) },
            })}
            style={styles.addBtn}
            testID="add-ledger-entry-btn"
          >
            <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : error && !data ? (
        <View style={{ padding: spacing.lg }}><ErrorState message={error} onRetry={load} testID="ledger-error" /></View>
      ) : (
        <>
          {isScoped ? (
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>TOTAL THIS MONTH</Text>
              <Text style={[styles.balanceValue, { color: colors.brandPrimary }]}>{fmtINR(data?.total || 0)}</Text>
              <Text style={styles.balanceHint}>{(data?.entries || []).length} {(data?.entries || []).length === 1 ? 'entry' : 'entries'} feeding this month's payroll figure</Text>
            </View>
          ) : (
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>CLOSING BALANCE</Text>
              <Text style={[styles.balanceValue, { color: (data?.closing_balance || 0) >= 0 ? colors.brandPrimary : colors.onError }]}>
                {(data?.closing_balance || 0) >= 0 ? '' : '- '}{fmtINR(data?.closing_balance || 0)}
              </Text>
              <Text style={styles.balanceHint}>Positive = employee is owed. Negative = employee owes.</Text>
            </View>
          )}

          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            showsVerticalScrollIndicator={false}
          >
            {(data?.entries || []).length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="book-outline" size={44} color={colors.mutedText} />
                <Text style={styles.emptyText}>No ledger entries yet</Text>
              </View>
            ) : (data?.entries || []).map((e: any) => {
              const canModify = canEdit && EDITABLE_TYPES.includes(e.type);
              const Row = canModify ? Pressable : View;
              return (
                <Row
                  key={e.id}
                  style={styles.row}
                  testID={`ledger-${e.id}`}
                  {...(canModify ? { onPress: () => setEditing(e) } : {})}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name={ICON[e.type] || 'ellipse-outline'} size={16} color={colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{e.title}</Text>
                    {!!e.description && <Text style={styles.rowDesc}>{e.description}</Text>}
                    <Text style={styles.rowDate}>{fmtDate(e.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {isScoped ? (
                      <Text style={styles.delta}>{fmtINR(e.amount)}</Text>
                    ) : e.delta !== 0 ? (
                      <Text style={[styles.delta, { color: e.delta > 0 ? colors.onSuccess : colors.onError }]}>
                        {e.delta > 0 ? '+' : '−'} {fmtINR(e.delta)}
                      </Text>
                    ) : <Text style={styles.deltaZero}>—</Text>}
                    {!isScoped && <Text style={styles.balance}>{fmtINR(e.balance)}</Text>}
                  </View>
                  {canModify && <Ionicons name="chevron-forward" size={16} color={colors.mutedText} style={{ marginLeft: spacing.xs }} />}
                </Row>
              );
            })}
          </ScrollView>
        </>
      )}

      {editing && (
        <EditEntrySheet
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </SafeAreaView>
  );
}

function EditEntrySheet({ entry, onClose, onSaved }: { entry: any; onClose: () => void; onSaved: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toneColor = { error: colors.onError, success: colors.onSuccess } as const;
  const [type, setType] = useState<typeof EDIT_TYPES[number]['key']>(
    (EDIT_TYPES.find((t) => t.key === entry.type)?.key || 'other') as any,
  );
  const [amount, setAmount] = useState(String(entry.amount ?? ''));
  const [note, setNote] = useState(entry.description || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submittingRef = useRef(false);

  const save = async () => {
    if (submittingRef.current) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Amount must be greater than 0'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put(`/ledger/entries/${entry.id}`, { entry_type: type, amount: amt, note });
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const confirmDelete = () => {
    confirmAction(
      'Delete entry?',
      `This removes "${entry.title}" (${fmtINR(entry.amount)}) from the ledger. This cannot be undone.`,
      'Delete',
      doDelete,
    );
  };

  const doDelete = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setDeleting(true);
    try {
      await api.del(`/ledger/entries/${entry.id}`);
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setDeleting(false); submittingRef.current = false; }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 36 }} testID="ledger-edit-sheet" keyboardShouldPersistTaps="handled">
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>Edit Entry</Text>
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              style={[styles.deleteIconBtn, deleting && { opacity: 0.5 }]}
              testID="ledger-delete-btn"
              hitSlop={10}
            >
              {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
            </Pressable>
          </View>

          <Text style={styles.label}>Type</Text>
          <View style={styles.typeGrid}>
            {EDIT_TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                style={[styles.typeBtn, type === t.key && styles.typeBtnActive]}
                testID={`ledger-edit-type-${t.key}`}
              >
                <View style={styles.typeIcon}><Ionicons name={t.icon} size={18} color={toneColor[t.tone]} /></View>
                <Text style={[styles.typeLabel, type === t.key && { color: colors.onSurface }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput
            testID="ledger-edit-amount"
            value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText}
            style={[styles.input, { fontSize: 20, textAlign: 'right' }]}
          />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            testID="ledger-edit-note"
            value={note} onChangeText={setNote} multiline
            placeholder="Reason or reference..." placeholderTextColor={colors.mutedText}
            style={styles.textArea}
          />

          <View style={styles.sheetActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="ledger-edit-cancel-btn">
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="ledger-edit-save-btn">
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },

  balanceCard: {
    margin: spacing.lg, marginBottom: 0, padding: spacing.lg,
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.lg, alignItems: 'center',
  },
  balanceLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1 },
  balanceValue: {
    fontSize: 34, fontWeight: '800', marginTop: 4,
    fontFamily: fonts.display,
  },
  balanceHint: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' },

  row: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  rowTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  rowDesc: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  rowDate: { color: colors.mutedText, fontSize: 11, marginTop: 4 },
  delta: { fontSize: 13, fontWeight: '800' },
  deltaZero: { color: colors.mutedText, fontSize: 13 },
  balance: { color: colors.mutedText, fontSize: 11, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderColor: colors.brand, borderTopWidth: 1, padding: spacing.lg, paddingBottom: 36,
  },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display },
  deleteIconBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error, borderWidth: 1, borderColor: colors.border,
  },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 14, fontSize: 15,
  },
  textArea: {
    minHeight: 80, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeBtn: {
    flexBasis: '31%', flexGrow: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center', gap: spacing.xs,
  },
  typeBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  typeIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: '700' },

  sheetActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: '700' },
  saveBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '800' },
});
