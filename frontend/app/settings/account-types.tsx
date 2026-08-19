import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Input, Button, Skeleton, useToast } from '@/src/components/ui';
import { confirmAction } from '@/src/utils/confirm';

// Account-type master editor (v2 Phase 6). The types here generate the Ledger's
// filter chips (Phase 5) and are the FK every account carries. The four base
// types (Customer, Karigar, Employee, Difference) are is_system — renamable but
// not deletable, since the ledger and its Difference/loss sink depend on them.
type AccountType = { id: string; name: string; key: string; is_system?: boolean; sort?: number };

export default function AccountTypesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [types, setTypes] = useState<AccountType[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    try { setTypes(await api.get<AccountType[]>('/account-types')); }
    catch { setTypes([]); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addType = async () => {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try {
      await api.post('/account-types', { name: n });
      setNewName(''); setAdding(false);
      toast.success('Type added');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Could not add type'); }
    finally { setBusy(false); }
  };

  const saveEdit = async (t: AccountType) => {
    const n = editName.trim();
    if (!n || n === t.name) { setEditingId(''); return; }
    try {
      await api.put(`/account-types/${t.id}`, { name: n });
      setEditingId('');
      toast.success('Renamed');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Could not rename'); }
  };

  const removeType = (t: AccountType) => {
    confirmAction('Delete type?', `Remove the "${t.name}" account type. Only allowed if no accounts use it.`, 'Delete', async () => {
      try {
        await api.del(`/account-types/${t.id}`);
        toast.success('Type deleted');
        await load();
      } catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="account-types-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Account Types</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>These generate the Ledger&apos;s filter chips and are the type every account is created under.</Text>

          {types === null ? (
            <View style={{ gap: spacing.sm }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} width="100%" height={52} radius={radius.md} />)}</View>
          ) : (
            <View style={styles.card}>
              {types.map((t, i) => (
                <View key={t.id} style={[styles.row, i < types.length - 1 && styles.rowBorder]} testID={`account-type-row-${t.key}`}>
                  {editingId === t.id ? (
                    <View style={{ flex: 1 }}>
                      <Input value={editName} onChangeText={setEditName} autoFocus onSubmitEditing={() => saveEdit(t)} testID={`account-type-edit-${t.key}`} />
                    </View>
                  ) : (
                    <>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowName}>{t.name}</Text>
                        {t.is_system && <Text style={styles.systemTag}>System · rename only</Text>}
                      </View>
                      <Pressable onPress={() => { setEditingId(t.id); setEditName(t.name); }} hitSlop={8} style={styles.rowBtn} testID={`account-type-rename-${t.key}`}>
                        <Ionicons name="pencil-outline" size={17} color={colors.onSurfaceSecondary} />
                      </Pressable>
                      {!t.is_system && (
                        <Pressable onPress={() => removeType(t)} hitSlop={8} style={styles.rowBtn} testID={`account-type-delete-${t.key}`}>
                          <Ionicons name="trash-outline" size={17} color={colors.onError} />
                        </Pressable>
                      )}
                    </>
                  )}
                  {editingId === t.id && (
                    <Pressable onPress={() => saveEdit(t)} hitSlop={8} style={styles.rowBtn} testID={`account-type-save-${t.key}`}>
                      <Ionicons name="checkmark" size={19} color={colors.brandPrimary} />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}

          {adding ? (
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}>
                <Input value={newName} onChangeText={setNewName} placeholder="e.g. Supplier, Bank" autoFocus onSubmitEditing={addType} testID="account-type-new-input" />
              </View>
              <Button label="Add" onPress={addType} loading={busy} fullWidth={false} testID="account-type-new-save" />
            </View>
          ) : (
            <Pressable onPress={() => setAdding(true)} style={styles.addBtn} testID="account-type-add">
              <Ionicons name="add" size={18} color={colors.brandSecondary} />
              <Text style={styles.addBtnText}>Add account type</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, minHeight: 52 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowName: { color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  systemTag: { color: colors.mutedText, fontSize: 10.5, marginTop: 2 },
  rowBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, paddingVertical: 13, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brand, borderStyle: 'dashed',
  },
  addBtnText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
