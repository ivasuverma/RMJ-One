import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Department = { id: string; name: string; is_active: boolean };

export default function DepartmentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Department[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Department[]>('/departments')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setEditingId(null); setName(''); };
  const closeForm = () => { resetForm(); setShowForm(false); };
  const startEdit = (d: Department) => { setEditingId(d.id); setName(d.name); setShowForm(true); };

  const submittingRef = useRef(false);
  const save = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { Alert.alert('Missing', 'Department name is required'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const payload = { name: name.trim(), is_active: true };
      if (editingId) await api.put(`/departments/${editingId}`, payload);
      else await api.post('/departments', payload);
      closeForm();
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (d: Department) => {
    confirmAction('Delete department', `Remove ${d.name}? This cannot be undone.`, 'Delete', async () => {
      setDeletingId(d.id);
      try {
        await api.del(`/departments/${d.id}`);
        if (editingId === d.id) closeForm();
        await load();
      } catch (e: any) {
        Alert.alert('Failed', e?.detail || 'Could not delete this department. Please try again.');
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="departments-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Departments</Text>
        <Pressable onPress={() => (showForm ? closeForm() : setShowForm(true))} style={[styles.iconBtn, styles.addTopBtn]} testID="show-add-dept-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {!showForm && <Text style={styles.hint}>Departments an employee can be assigned to — used across Attendance, Payroll and the Employee profile.</Text>}

          {showForm && (
            <View style={styles.formCard} testID="add-dept-form">
              <Text style={styles.section}>{editingId ? 'Edit Department' : 'Add Department'}</Text>
              <TextInput testID="dept-name" value={name} onChangeText={setName} placeholder="e.g. Sales, Workshop, Accounts" placeholderTextColor={colors.mutedText} style={styles.input} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {editingId && (
                  <Pressable style={styles.cancelEditBtn} onPress={resetForm} testID="cancel-edit-dept-btn">
                    <Text style={styles.cancelEditText}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.addBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save} testID="save-dept-btn">
                  {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name={editingId ? 'checkmark' : 'add'} size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.addBtnText}>{editingId ? 'Update Department' : 'Add Department'}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.section, { marginTop: showForm ? spacing.lg : spacing.sm }]}>Existing Departments · {items.length}</Text>
          {items.map((d) => (
            <View key={d.id} style={[styles.card, editingId === d.id && styles.cardEditing]} testID={`dept-${d.id}`}>
              <Pressable style={{ flex: 1 }} onPress={() => startEdit(d)} testID={`edit-dept-${d.id}`}>
                <Text style={styles.cName}>{d.name}</Text>
              </Pressable>
              <Pressable onPress={() => startEdit(d)} style={styles.editBtn} hitSlop={10} testID={`edit-icon-dept-${d.id}`}>
                <Ionicons name="create-outline" size={16} color={colors.brandSecondary} />
              </Pressable>
              <Pressable onPress={() => remove(d)} style={styles.delBtn} hitSlop={10} disabled={deletingId === d.id} testID={`del-dept-${d.id}`}>
                {deletingId === d.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600', fontFamily: fonts.display },
  addTopBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  cancelEditBtn: {
    paddingHorizontal: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  cancelEditText: { color: colors.onSurfaceTertiary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardEditing: { borderColor: colors.brandPrimary },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  editBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    borderColor: colors.brand, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
