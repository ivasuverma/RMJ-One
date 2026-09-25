import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform, Linking } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';

type Piece = { id: string; name: string; metal: string; visible: boolean; thumb: string | null };

const METALS = ['22K gold', '18K gold', 'Rose gold', 'Polki', 'Kundan', 'Diamond', 'Lab-grown diamond', 'Silver'];

// Manages the "Fresh at the counter" row on rmj.co.in (website/index.html
// reads GET /api/public/website/pieces). Newest piece shows first; hidden
// pieces stay here but disappear from the website.
export default function WebsiteScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', metal: '' });

  const load = useCallback(async () => {
    try { setPieces(await api.get<Piece[]>('/website/pieces')); }
    catch (e: any) { setPieces([]); toast.error(e?.detail || 'Could not load pieces'); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    const file = await pickWebFile('image/*');
    if (!file) return;
    setAdding(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name || 'photo.jpg');
      form.append('metal', '22K gold');
      const p = await api.upload<Piece>('/website/pieces', form);
      setPieces((cur) => [p, ...(cur || [])]);
      setEditing(p.id); setDraft({ name: p.name, metal: p.metal });
      toast.success('Photo added — now give it a name');
    } catch (e: any) { toast.error(e?.detail || 'Upload failed'); }
    finally { setAdding(false); }
  };

  const patch = async (id: string, body: Partial<Piece>) => {
    setPieces((cur) => (cur || []).map((p) => (p.id === id ? { ...p, ...body } : p)));
    try { await api.patch(`/website/pieces/${id}`, body); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); load(); }
  };

  const saveEdit = async (id: string) => {
    await patch(id, { name: draft.name.trim(), metal: draft.metal.trim() });
    setEditing(null);
    toast.success('Saved');
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!pieces) return;
    const j = index + dir;
    if (j < 0 || j >= pieces.length) return;
    const next = [...pieces];
    [next[index], next[j]] = [next[j], next[index]];
    setPieces(next);
    try { await api.put('/website/pieces/order', { ids: next.map((p) => p.id) }); }
    catch (e: any) { toast.error(e?.detail || 'Could not reorder'); load(); }
  };

  const remove = (p: Piece) => confirmAction(
    'Delete this piece?', `${p.name || p.metal || 'This photo'} will be removed from the website.`, 'Delete',
    async () => {
      try {
        await api.del(`/website/pieces/${p.id}`);
        setPieces((cur) => (cur || []).filter((x) => x.id !== p.id));
        toast.success('Deleted');
      } catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
    },
  );

  const shown = (pieces || []).filter((p) => p.visible).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="website-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Fresh at the Counter</Text>
        <Pressable onPress={() => Linking.openURL('https://rmj.co.in/#counter')} style={styles.iconBtn} hitSlop={12} accessibilityRole="link" accessibilityLabel="Open the website">
          <Ionicons name="open-outline" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          New pieces shown on rmj.co.in. Customers tap one to ask about it on WhatsApp, with the photo attached. The newest
          piece shows first; hide a piece once it’s sold.
          {pieces && pieces.length === 0 ? ' Until you add photos, the website shows its built-in set.' : ''}
        </Text>

        <Pressable onPress={add} disabled={adding} style={[styles.addBtn, adding && { opacity: 0.6 }]} testID="website-add-piece" accessibilityRole="button">
          {adding ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <Ionicons name="add-circle-outline" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.addText}>{Platform.OS === 'web' ? 'Add photo' : 'Add photo (web app)'}</Text>
            </>
          )}
        </Pressable>

        {pieces === null ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            {pieces.length > 0 && <Text style={styles.count}>{shown} of {pieces.length} showing on the website</Text>}
            {pieces.map((p, i) => (
              <View key={p.id} style={[styles.card, !p.visible && { opacity: 0.55 }]} testID={`website-piece-${p.id}`}>
                <View style={styles.row}>
                  {p.thumb ? <Image source={{ uri: p.thumb }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>{p.name || p.metal || 'Untitled'}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{p.name ? p.metal : 'No name — the website shows the metal'}</Text>
                  </View>
                  <View style={styles.moveCol}>
                    <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move up" style={i === 0 && { opacity: 0.3 }}>
                      <Ionicons name="chevron-up" size={20} color={colors.onSurface} />
                    </Pressable>
                    <Pressable onPress={() => move(i, 1)} disabled={i === pieces.length - 1} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move down" style={i === pieces.length - 1 && { opacity: 0.3 }}>
                      <Ionicons name="chevron-down" size={20} color={colors.onSurface} />
                    </Pressable>
                  </View>
                </View>

                {editing === p.id ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={styles.label}>Name (optional)</Text>
                    <TextInput value={draft.name} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="e.g. Temple necklace" placeholderTextColor={colors.mutedText} style={styles.input} maxLength={60} />
                    <Text style={styles.label}>Metal</Text>
                    <View style={styles.chips}>
                      {METALS.map((m) => (
                        <Pressable key={m} onPress={() => setDraft((d) => ({ ...d, metal: m }))} style={[styles.chip, draft.metal === m && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: draft.metal === m }}>
                          <Text style={[styles.chipText, draft.metal === m && styles.chipTextOn]}>{m}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
                      <Pressable onPress={() => setEditing(null)} style={[styles.smallBtn, { flex: 1 }]} accessibilityRole="button"><Text style={styles.smallBtnText}>Cancel</Text></Pressable>
                      <Pressable onPress={() => saveEdit(p.id)} style={[styles.smallBtn, styles.smallBtnPrimary, { flex: 1 }]} accessibilityRole="button"><Text style={[styles.smallBtnText, { color: colors.onBrandPrimary }]}>Save</Text></Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
                    <Pressable onPress={() => patch(p.id, { visible: !p.visible })} style={[styles.row, { flex: 1, gap: spacing.sm }]} accessibilityRole="switch" accessibilityState={{ checked: p.visible }}>
                      <ToggleSwitch value={p.visible} />
                      <Text style={styles.sub}>{p.visible ? 'On website' : 'Hidden'}</Text>
                    </Pressable>
                    <Pressable onPress={() => { setEditing(p.id); setDraft({ name: p.name, metal: p.metal }); }} style={styles.smallBtn} accessibilityRole="button"><Text style={styles.smallBtnText}>Edit</Text></Pressable>
                    <Pressable onPress={() => remove(p)} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel="Delete">
                      <Ionicons name="trash-outline" size={16} color={colors.onError} />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  hint: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginBottom: spacing.lg },
  addText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  count: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.mutedText, fontSize: 12 },
  moveCol: { gap: 4, alignItems: 'center' },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '600' },
  chipTextOn: { color: colors.brandPrimary },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  smallBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  smallBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
});
