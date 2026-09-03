import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Location = { id: string; name: string; address: string; is_active: boolean };

export default function LocationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Location[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Location[]>('/locations')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setEditingId(null); setName(''); setAddress(''); };
  const closeForm = () => { resetForm(); setShowForm(false); };
  const startEdit = (l: Location) => { setEditingId(l.id); setName(l.name); setAddress(l.address || ''); setShowForm(true); };

  const submittingRef = useRef(false);
  const save = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { notify('Missing', 'Location name is required'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const payload = { name: name.trim(), address: address.trim(), is_active: true };
      if (editingId) await api.put(`/locations/${editingId}`, payload);
      else await api.post('/locations', payload);
      closeForm();
      await load();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (l: Location) => {
    confirmAction('Delete location', `Remove ${l.name}? This cannot be undone.`, 'Delete', async () => {
      setDeletingId(l.id);
      try {
        await api.del(`/locations/${l.id}`);
        if (editingId === l.id) closeForm();
        await load();
      } catch (e: any) {
        notify('Failed', e?.detail || 'Could not delete this location. Please try again.');
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="locations-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Locations / Branches</Text>
        <Pressable onPress={() => (showForm ? closeForm() : setShowForm(true))} style={[styles.iconBtn, styles.addTopBtn]} testID="show-add-loc-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {!showForm && <Text style={styles.hint}>Shop locations/branches an employee can be assigned to — used across Attendance, Payroll and the Employee profile.</Text>}

          {showForm && (
            <View style={styles.formCard} testID="add-loc-form">
              <Text style={styles.section}>{editingId ? 'Edit Location' : 'Add Location'}</Text>
              <TextInput testID="loc-name" value={name} onChangeText={setName} placeholder="e.g. Main Branch, Field Ganj" placeholderTextColor={colors.mutedText} style={styles.input} />
              <TextInput testID="loc-address" value={address} onChangeText={setAddress} placeholder="Address (optional)" placeholderTextColor={colors.mutedText} style={styles.input} multiline />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {editingId && (
                  <Pressable style={styles.cancelEditBtn} onPress={resetForm} testID="cancel-edit-loc-btn">
                    <Text style={styles.cancelEditText}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.addBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save} testID="save-loc-btn">
                  {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name={editingId ? 'checkmark' : 'add'} size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.addBtnText}>{editingId ? 'Update Location' : 'Add Location'}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.section, { marginTop: showForm ? spacing.lg : spacing.sm }]}>Existing Locations · {items.length}</Text>
          {items.map((l) => (
            <View key={l.id} style={[styles.card, editingId === l.id && styles.cardEditing]} testID={`loc-${l.id}`}>
              <Pressable style={{ flex: 1 }} onPress={() => startEdit(l)} testID={`edit-loc-${l.id}`}>
                <Text style={styles.cName}>{l.name}</Text>
                {!!l.address && <Text style={styles.cMeta} numberOfLines={1}>{l.address}</Text>}
              </Pressable>
              <Pressable onPress={() => startEdit(l)} style={styles.editBtn} hitSlop={10} testID={`edit-icon-loc-${l.id}`}>
                <Ionicons name="create-outline" size={16} color={colors.brandSecondary} />
              </Pressable>
              <Pressable onPress={() => remove(l)} style={styles.delBtn} hitSlop={10} disabled={deletingId === l.id} testID={`del-loc-${l.id}`}>
                {deletingId === l.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
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
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  editBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    borderColor: colors.brand, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
