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

type ItemMaster = { id: string; name: string; purity: number; category: string; active: boolean };

const COMMON_PURITIES = [
  { label: '24K (99.9%)', value: '99.9' },
  { label: '22K (91.6%)', value: '91.6' },
  { label: '18K (75%)', value: '75' },
  { label: '14K (58.5%)', value: '58.5' },
];

export default function ItemMasterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [name, setName] = useState('');
  const [purity, setPurity] = useState('91.6');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await api.get<ItemMaster[]>('/item-master')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return false;
    if (!name.trim()) { notify('Missing', 'Enter a name for this item'); return false; }
    const p = parseFloat(purity);
    if (!p || p <= 0 || p > 100) { notify('Invalid', 'Purity must be between 0 and 100'); return false; }
    submittingRef.current = true;
    setSaving(true);
    try {
      if (editingId) {
        const existing = items.find((it) => it.id === editingId);
        await api.put(`/item-master/${editingId}`, { name: name.trim(), purity: p, category: category.trim(), active: existing?.active ?? true });
      } else {
        await api.post('/item-master', { name: name.trim(), purity: p, category: category.trim(), active: true });
      }
      setName(''); setCategory(''); setEditingId(null); await load();
      return true;
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); return false; }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const startEdit = (it: ItemMaster) => {
    setEditingId(it.id); setName(it.name); setCategory(it.category || ''); setPurity(String(it.purity));
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setName(''); setCategory(''); setPurity('91.6'); };

  const toggleActive = async (it: ItemMaster) => {
    try { await api.put(`/item-master/${it.id}`, { ...it, active: !it.active }); await load(); }
    catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
  };

  const remove = (it: ItemMaster) => {
    confirmAction('Delete item', `Remove "${it.name}"?`, 'Delete', async () => {
      try { await api.del(`/item-master/${it.id}`); await load(); }
      catch (e: any) { notify('Failed', e?.detail || 'Could not delete this item.'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="item-master-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Items & Purity</Text>
        <Pressable onPress={() => (showForm ? closeForm() : setShowForm(true))} style={[styles.iconBtn, styles.addTopBtn]} testID="show-add-item-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {!showForm && <Text style={styles.hint}>Predefine item types with their gold purity (e.g. 22K = 91.6%). Picking one on a repair item lets the karigar's gold ledger track fine-gold-equivalent weight instead of raw gross grams.</Text>}

          {showForm && (
            <View style={styles.formCard} testID="add-item-form">
              <Text style={styles.section}>{editingId ? 'Edit Item' : 'Add Item'}</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput testID="item-name" value={name} onChangeText={setName} placeholder="e.g. 22K Ring, 18K Chain" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Category (optional)</Text>
              <TextInput testID="item-category" value={category} onChangeText={setCategory} placeholder="e.g. Ring, Chain, Bangle" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Purity (%)</Text>
              <View style={styles.chipRow}>
                {COMMON_PURITIES.map((p) => (
                  <Pressable key={p.value} onPress={() => setPurity(p.value)} style={[styles.chip, purity === p.value && styles.chipActive]} testID={`purity-${p.value}`}>
                    <Text style={[styles.chipText, purity === p.value && styles.chipTextActive]}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput testID="item-purity" value={purity} onChangeText={(v) => setPurity(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="91.6" placeholderTextColor={colors.mutedText} style={styles.input} />

              <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={async () => { if (await add()) setShowForm(false); }} testID="add-item-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name={editingId ? 'checkmark' : 'add'} size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>{editingId ? 'Save Changes' : 'Add Item'}</Text></>}
              </Pressable>
            </View>
          )}

          <Text style={[styles.section, { marginTop: showForm ? spacing.lg : spacing.sm }]}>All Items · {items.length}</Text>
          {items.map((it) => (
            <View key={it.id} style={[styles.card, !it.active && { opacity: 0.55 }]} testID={`item-${it.id}`}>
              <View style={styles.iconBox}><Ionicons name="diamond-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{it.name}</Text>
                <Text style={styles.cMeta}>{it.purity}% purity{it.category ? ` · ${it.category}` : ''}</Text>
              </View>
              <Pressable onPress={() => startEdit(it)} style={styles.editBtn} hitSlop={10} testID={`edit-item-${it.id}`}>
                <Ionicons name="pencil-outline" size={15} color={colors.onSurfaceSecondary} />
              </Pressable>
              <Pressable onPress={() => toggleActive(it)} style={styles.smallBtn} testID={`toggle-item-${it.id}`}>
                <Text style={styles.smallBtnText}>{it.active ? 'Pause' : 'Resume'}</Text>
              </Pressable>
              <Pressable onPress={() => remove(it)} style={styles.delBtn} hitSlop={10} testID={`del-item-${it.id}`}>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  addTopBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4, marginTop: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 8, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
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
  editBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
