import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Just a plain ordered string list on the `samples` settings doc (see
// GET/PUT /samples/issue-types in routers/samples.py) — no per-item id or
// active flag like Repair Types/Document Categories, since a reason for
// issuing a sample carries no extra metadata worth tracking.
export default function SampleIssueTypesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newType, setNewType] = useState('');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try { setTypes((await api.get<{ issue_types: string[] }>('/samples/issue-types')).issue_types); }
    catch (_e) { setTypes([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (next: string[]) => {
    setTypes(next); // optimistic — reverted by load() below if the save fails
    setSaving(true);
    try { await api.put('/samples/issue-types', { issue_types: next }); }
    catch (e: any) { notify('Failed', e?.detail || 'Please try again'); await load(); }
    finally { setSaving(false); }
  };

  const add = async () => {
    if (submittingRef.current) return;
    const t = newType.trim();
    if (!t) return;
    if (types.some((x) => x.toLowerCase() === t.toLowerCase())) { notify('Already there', `"${t}" is already in the list`); return; }
    submittingRef.current = true;
    try { await save([...types, t]); setNewType(''); }
    finally { submittingRef.current = false; }
  };

  const remove = (t: string) => save(types.filter((x) => x !== t));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-issue-types-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Sample Issue Types</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.hint}>Predefine the common reasons a sample goes out — pick one instead of typing it each time on Stock In/Out. Changes save immediately.</Text>

          <View style={styles.addRow}>
            <TextInput
              testID="issue-type-new" value={newType} onChangeText={setNewType} onSubmitEditing={add}
              placeholder="e.g. Quoting" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} returnKeyType="done"
            />
            <Pressable onPress={add} disabled={saving || !newType.trim()} style={[styles.addBtn, (saving || !newType.trim()) && { opacity: 0.5 }]} testID="issue-type-add">
              <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>

          {types.length === 0 ? (
            <Text style={styles.empty}>No types yet — anyone issuing a sample will need to type a reason instead.</Text>
          ) : types.map((t) => (
            <View key={t} style={styles.row} testID={`issue-type-${t}`}>
              <Text style={styles.rowText}>{t}</Text>
              <Pressable onPress={() => remove(t)} style={styles.delBtn} hitSlop={10} testID={`issue-type-del-${t}`}>
                <Ionicons name="trash-outline" size={16} color={colors.onError} />
              </Pressable>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
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
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderWidth: 1, borderColor: colors.onError, alignItems: 'center', justifyContent: 'center',
  },
});
