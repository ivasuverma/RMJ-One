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

type RT = { id: string; name: string; default_labour: number; requires_karigar_default: boolean; active: boolean };

export default function RepairTypesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<RT[]>([]);
  const [name, setName] = useState('');
  const [labour, setLabour] = useState('');
  const [needsKarigar, setNeedsKarigar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<RT[]>('/repair-types')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { Alert.alert('Missing', 'Enter a name for this repair type'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/repair-types', { name: name.trim(), default_labour: parseFloat(labour) || 0, requires_karigar_default: needsKarigar, active: true });
      setName(''); setLabour(''); setNeedsKarigar(false); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const toggleActive = async (rt: RT) => {
    try { await api.put(`/repair-types/${rt.id}`, { ...rt, active: !rt.active }); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
  };

  const remove = (rt: RT) => {
    confirmAction('Delete repair type', `Remove "${rt.name}"?`, 'Delete', async () => {
      try { await api.del(`/repair-types/${rt.id}`); await load(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this repair type.'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-types-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Repair Types</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.hint}>Predefine the repair jobs you do often — picking one on a repair item prefills its labour charge and whether it usually needs a karigar.</Text>

          <Text style={styles.section}>Add Repair Type</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput testID="rt-name" value={name} onChangeText={setName} placeholder="e.g. Sizing, Polish, Stone Setting" placeholderTextColor={colors.mutedText} style={styles.input} />
          <Text style={styles.label}>Default labour charge (₹)</Text>
          <TextInput testID="rt-labour" value={labour} onChangeText={(v) => setLabour(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
          <Pressable onPress={() => setNeedsKarigar((v) => !v)} style={styles.checkRow} testID="rt-needs-karigar">
            <View style={[styles.checkbox, needsKarigar && styles.checkboxOn]}>{needsKarigar && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
            <Text style={styles.checkLabel}>Usually needs a karigar</Text>
          </Pressable>
          <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="add-rt-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>Add Repair Type</Text></>}
          </Pressable>

          <Text style={[styles.section, { marginTop: spacing.xl }]}>All Types</Text>
          {items.map((rt) => (
            <View key={rt.id} style={[styles.card, !rt.active && { opacity: 0.55 }]} testID={`rt-${rt.id}`}>
              <View style={styles.iconBox}><Ionicons name="construct-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{rt.name}</Text>
                <Text style={styles.cMeta}>₹{rt.default_labour.toFixed(0)} labour{rt.requires_karigar_default ? ' · needs karigar' : ''}</Text>
              </View>
              <Pressable onPress={() => toggleActive(rt)} style={styles.smallBtn} testID={`toggle-rt-${rt.id}`}>
                <Text style={styles.smallBtnText}>{rt.active ? 'Pause' : 'Resume'}</Text>
              </Pressable>
              <Pressable onPress={() => remove(rt)} style={styles.delBtn} hitSlop={10} testID={`del-rt-${rt.id}`}>
                <Ionicons name="trash-outline" size={16} color={colors.onError} />
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
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4, marginTop: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
