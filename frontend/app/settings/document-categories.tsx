import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';

type Cat = {
  id: string; key: string; label: string; icon: keyof typeof Ionicons.glyphMap;
  visible_to_roles: string[]; can_record_roles: string[]; active: boolean;
};

// Every role is granted by default now — who actually sees/records each
// category is set per person in Settings › People, which overrides these.
const ALL_ROLES = ['owner', 'admin', 'accountant', 'employee'];

export default function DocumentCategoriesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    try { setCats(await api.get<Cat[]>('/document-categories?all=1')); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => { setIsNew(true); setEditing({ id: '', key: '', label: '', icon: 'document-outline', visible_to_roles: [...ALL_ROLES], can_record_roles: [...ALL_ROLES], active: true }); };
  const openEdit = (c: Cat) => { setIsNew(false); setEditing({ ...c, visible_to_roles: [...c.visible_to_roles], can_record_roles: [...c.can_record_roles] }); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="doc-categories-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Document Categories</Text>
        <Pressable onPress={openNew} style={styles.iconBtn} hitSlop={12} testID="doc-cat-add"><Ionicons name="add" size={22} color={colors.onSurface} /></Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
          <Text style={styles.hint}>The kinds of document you can file. Who can view or record each one is set per person in Settings › People.</Text>
          {cats.map((c) => (
            <Pressable key={c.id} onPress={() => openEdit(c)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} testID={`doc-cat-${c.key}`}>
              <View style={styles.rowIcon}><Ionicons name={c.icon || 'document-outline'} size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowLabel}>{c.label}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>{c.active !== false ? 'Active' : 'Off · hidden from capture'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}

      <CategoryEditor cat={editing} isNew={isNew} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast.success('Saved'); }} />
    </SafeAreaView>
  );
}

function CategoryEditor({ cat, isNew, onClose, onSaved }: { cat: Cat | null; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  // Re-seed local form state whenever a different category opens.
  useEffect(() => {
    if (cat) { setLabel(cat.label); setActive(cat.active !== false); }
  }, [cat?.id, cat?.label, cat]);

  const remove = () => {
    if (!cat) return;
    confirmAction('Delete category?', `Remove "${cat.label}". Only possible when it has no documents — otherwise turn it off instead.`, 'Delete', async () => {
      try { await api.del(`/document-categories/${cat.id}`); onSaved(); }
      catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
    });
  };

  const save = async () => {
    if (!cat || busy) return;
    if (!label.trim()) { toast.error('Enter a name'); return; }
    // Role lists are no longer edited here — permissions live per person in
    // People. Pass through whatever the category already had (new ones default
    // to all roles) so the role-based fallback stays sensible.
    const vis = Array.from(new Set(['owner', ...(cat.visible_to_roles || [])]));
    const rec = Array.from(new Set(['owner', ...(cat.can_record_roles || [])]));
    setBusy(true);
    try {
      const body = { label: label.trim(), icon: cat.icon || 'document-outline', visible_to_roles: vis, can_record_roles: rec, active };
      if (isNew) await api.post('/document-categories', body);
      else await api.put(`/document-categories/${cat.id}`, body);
      onSaved();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet visible={!!cat} onClose={onClose} title={isNew ? 'New category' : 'Edit category'} testID="doc-cat-editor">
      <Text style={styles.formLabel}>Name</Text>
      <TextInput value={label} onChangeText={setLabel} placeholder="e.g. Expense Bills" placeholderTextColor={colors.mutedText} style={styles.input} testID="doc-cat-name" />

      <Text style={styles.permNote}>View &amp; record permissions are set per person in Settings › People.</Text>

      <Pressable onPress={() => setActive((a) => !a)} style={styles.activeRow} testID="doc-cat-active">
        <View style={{ flex: 1 }}>
          <Text style={styles.activeLabel}>Active</Text>
          <Text style={styles.activeSub}>Off hides it from capture and lists (history is kept)</Text>
        </View>
        <View style={[styles.switch, active && styles.switchOn]}><View style={[styles.knob, active && styles.knobOn]} /></View>
      </Pressable>

      <View style={{ height: spacing.md }} />
      <Pressable onPress={save} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="doc-cat-save">
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
      </Pressable>
      {!isNew && (
        <Pressable onPress={remove} style={styles.deleteBtn} testID="doc-cat-delete">
          <Ionicons name="trash-outline" size={16} color={colors.onError} />
          <Text style={styles.deleteText}>Delete category</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  hint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.onSurface, fontSize: 15.5, fontWeight: '600' },
  rowMeta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },

  formLabel: { color: colors.onSurfaceSecondary, fontSize: 12, letterSpacing: 0.4, marginBottom: 8, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15 },
  permNote: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  activeLabel: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  activeSub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', padding: 2 },
  switchOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.onSurfaceTertiary },
  knobOn: { backgroundColor: colors.onBrandPrimary, alignSelf: 'flex-end' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error },
  deleteText: { color: colors.onError, fontSize: 14, fontWeight: '700' },
});
