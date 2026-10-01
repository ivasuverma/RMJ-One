import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { GlassButton } from '@/src/components/ui/GlassButton';

type EntryType = 'received' | 'paid';
type QuickName = { id: string; name: string; entry_type: EntryType | null; active?: boolean };

// Predefined "Type" options for Cash Book entries (Settings > Masters) —
// shown on the entry form as chips, filtered to whichever list matches the
// entry's own Received/Paid, and shown on the day list under the entry's
// name. Backed by the same cashbook_quick_names collection the form's Type
// picker reads from (see routers/cashbook.py) — a preset with no entry_type
// is a legacy/shared one from before this master existed and shows in
// neither tab here, but still shows on both entry types in the form itself.
export default function CashbookTypesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<EntryType>('received');
  const [types, setTypes] = useState<QuickName[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newType, setNewType] = useState('');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try { setTypes(await api.get<QuickName[]>('/cashbook/quick-names')); }
    catch (_e) { setTypes([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = types.filter((t) => t.entry_type === tab);

  const add = async () => {
    if (submittingRef.current) return;
    const n = newType.trim();
    if (!n) return;
    if (visible.some((t) => t.name.toLowerCase() === n.toLowerCase())) {
      notify('Already there', `"${n}" is already in this list`);
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const created = await api.post<QuickName>('/cashbook/quick-names', { name: n, entry_type: tab });
      setTypes((prev) => [...prev, created]);
      setNewType('');
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  // Rename in place: the pencil turns the row into a text box; Enter or the tick saves.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const startRename = (t: QuickName) => { setEditingId(t.id); setEditName(t.name); };
  const saveRename = async (t: QuickName) => {
    const n = editName.trim();
    if (!n || n === t.name) { setEditingId(null); return; }
    try {
      const updated = await api.put<QuickName>(`/cashbook/quick-names/${t.id}`, { name: n });
      setTypes((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      setEditingId(null);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
  };

  // Switched off: kept (and still shown on past entries) but not offered on new ones.
  const toggleActive = async (t: QuickName) => {
    const active = t.active === false;
    setTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, active } : x)));
    try { await api.put(`/cashbook/quick-names/${t.id}`, { active }); }
    catch (e: any) { notify('Failed', e?.detail || 'Please try again'); await load(); }
  };

  const remove = async (t: QuickName) => {
    setTypes((prev) => prev.filter((x) => x.id !== t.id)); // optimistic — reverted by load() below if the delete fails
    try { await api.del(`/cashbook/quick-names/${t.id}`); }
    catch (e: any) { notify('Failed', e?.detail || 'Please try again'); await load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cashbook-types-screen">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>Cash Pay & Receive Types</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabRow}>
        {(['received', 'paid'] as const).map((t) => (
          <Pressable
            key={t} onPress={() => setTab(t)}
            style={[styles.tabBtn, tab === t && (t === 'received' ? styles.tabBtnReceived : styles.tabBtnPaid)]}
            testID={`cashbook-types-tab-${t}`}
          >
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>{t === 'received' ? 'Cash Receive Types' : 'Cash Pay Types'}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.hint}>
            Predefine the common {tab === 'received' ? 'sources cash comes in from' : 'reasons cash goes out'} — pick one
            instead of typing it each time on Cash Book. Changes save immediately.
          </Text>

          <View style={styles.addRow}>
            <TextInput
              testID="cashbook-type-new" value={newType} onChangeText={setNewType} onSubmitEditing={add}
              placeholder={tab === 'received' ? 'e.g. Sales, Advance' : 'e.g. Salary, Rent'}
              placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} returnKeyType="done"
            />
            <Pressable onPress={add} disabled={saving || !newType.trim()} style={[styles.addBtn, (saving || !newType.trim()) && { opacity: 0.5 }]} testID="cashbook-type-add">
              <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>

          {visible.length === 0 ? (
            <Text style={styles.empty}>No {tab === 'received' ? 'receive' : 'pay'} types yet — the Type field will just be left blank on entries.</Text>
          ) : visible.map((t) => (
            <View key={t.id} style={[styles.row, t.active === false && styles.rowOff]} testID={`cashbook-type-${t.id}`}>
              {editingId === t.id ? (
                <>
                  <TextInput
                    value={editName} onChangeText={setEditName} onSubmitEditing={() => saveRename(t)} autoFocus
                    style={[styles.input, styles.renameInput]} returnKeyType="done" testID={`cashbook-type-rename-input-${t.id}`}
                  />
                  <GlassButton onPress={() => saveRename(t)} style={styles.iconBtnSm} hitSlop={8} testID={`cashbook-type-rename-save-${t.id}`}>
                    <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />
                  </GlassButton>
                  <GlassButton onPress={() => setEditingId(null)} style={styles.iconBtnSm} hitSlop={8}>
                    <Ionicons name="close" size={18} color={colors.mutedText} />
                  </GlassButton>
                </>
              ) : (
                <>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowText, t.active === false && styles.rowTextOff]} numberOfLines={1}>{t.name}</Text>
                    {t.active === false && <Text style={styles.offTag}>Hidden · not offered on new entries</Text>}
                  </View>
                  <GlassButton onPress={() => startRename(t)} style={styles.iconBtnSm} hitSlop={8} testID={`cashbook-type-rename-${t.id}`} accessibilityLabel={`Rename ${t.name}`}>
                    <Ionicons name="create-outline" size={18} color={colors.onSurface} />
                  </GlassButton>
                  <Pressable onPress={() => toggleActive(t)} hitSlop={8} testID={`cashbook-type-active-${t.id}`}
                    accessibilityRole="switch" accessibilityState={{ checked: t.active !== false }} accessibilityLabel={`${t.name} active`}>
                    <ToggleSwitch value={t.active !== false} />
                  </Pressable>
                  <Pressable onPress={() => remove(t)} style={styles.delBtn} hitSlop={10} testID={`cashbook-type-del-${t.id}`}>
                    <Ionicons name="trash-outline" size={16} color={colors.onError} />
                  </Pressable>
                </>
              )}
            </View>
          ))}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  tabRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tabBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  tabBtnReceived: { backgroundColor: colors.brandTertiary, borderColor: colors.onSuccess },
  tabBtnPaid: { backgroundColor: colors.brandTertiary, borderColor: colors.onError },
  tabBtnText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '700' },
  tabBtnTextActive: { color: colors.onSurface },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.sm,
  },
  rowText: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  rowOff: { opacity: 0.75 },
  rowTextOff: { color: colors.mutedText },
  offTag: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  renameInput: { flex: 1, paddingVertical: 8 },
  iconBtnSm: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderWidth: 1, borderColor: colors.onError, alignItems: 'center', justifyContent: 'center',
  },
});
