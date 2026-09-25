import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { Content, Header, OwnSection, abs, makeStyles } from '../_shared';

// One of the shop's own sections on rmj.co.in: a heading, some text and a
// row of photos (each opens a WhatsApp enquiry on the site). `new` creates
// one; photos can be added once it exists.
export default function WebsiteOwnSectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const o = useMemo(() => ownStyles(colors), [colors]);
  const toast = useToast();
  const [sec, setSec] = useState<OwnSection | null>(isNew ? { id: '', title: '', text: '', visible: true, photos: [] } : null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const take = (s: OwnSection) => {
    setSec(s); setTitle(s.title); setText(s.text);
    setCaptions(Object.fromEntries(s.photos.map((p) => [p.id, p.caption])));
  };
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const c = await api.get<Content>('/website/content');
      const s = c.sections.find((x) => x.id === id);
      if (s) take(s); else { toast.error('Section not found'); router.back(); }
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
  }, [id, isNew, router, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  if (!sec) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="website-own-screen">
        <Header title="Section" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const dirty = isNew ? !!title.trim() : title !== sec.title || text !== sec.text;
  const save = () => run('save', async () => {
    if (isNew) {
      const s = await api.post<OwnSection>('/website/sections', { title, text });
      toast.success('Section added — now add photos');
      router.replace(`/website/custom/${s.id}` as any);
    } else {
      take(await api.patch<OwnSection>(`/website/sections/${sec.id}`, { title, text }));
      toast.success('Saved — live on rmj.co.in');
    }
  });
  const setVisible = (v: boolean) => run('visible', async () => {
    take(await api.patch<OwnSection>(`/website/sections/${sec.id}`, { visible: v }));
  });
  const addPhoto = async () => {
    const file = await pickWebFile('image/*');
    if (!file) return;
    run('photo', async () => {
      const form = new FormData();
      form.append('file', file, file.name || 'photo.jpg');
      take(await api.upload<OwnSection>(`/website/sections/${sec.id}/photos`, form));
    });
  };
  const saveCaption = (pid: string) => {
    const p = sec.photos.find((x) => x.id === pid);
    if (!p || (captions[pid] ?? '') === p.caption) return;
    run(`cap-${pid}`, async () => { take(await api.patch<OwnSection>(`/website/sections/${sec.id}/photos/${pid}`, { caption: captions[pid] ?? '' })); });
  };
  const removePhoto = (pid: string) => confirmAction('Remove this photo?', 'It comes off the website straight away.', 'Remove',
    () => run(`del-${pid}`, async () => { take(await api.del<OwnSection>(`/website/sections/${sec.id}/photos/${pid}`)); }));
  const removeSection = () => confirmAction('Delete this section?', `“${sec.title}” and its photos come off the website.`, 'Delete',
    () => run('delete', async () => { await api.del(`/website/sections/${sec.id}`); toast.success('Section deleted'); router.back(); }));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="website-own-screen">
      <Header title={isNew ? 'New section' : 'Your section'} colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!isNew && (
          <Pressable onPress={() => setVisible(!sec.visible)} disabled={busy === 'visible'} style={[styles.card, styles.row]} accessibilityRole="switch" accessibilityState={{ checked: sec.visible }} testID="website-own-visible">
            <View style={styles.flex1}>
              <Text style={styles.cardTitle}>Show on the website</Text>
              <Text style={styles.hint}>{sec.visible ? 'Visitors see this section.' : 'Hidden — kept here until you switch it back on.'}</Text>
            </View>
            <ToggleSwitch value={sec.visible} />
          </Pressable>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Heading</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Bridal collection" placeholderTextColor={colors.mutedText} style={styles.input} testID="website-own-title" />
          <Text style={[styles.label, { marginTop: 6 }]}>Text (optional)</Text>
          <TextInput value={text} onChangeText={setText} multiline placeholder="A line or two about it — new lines are kept." placeholderTextColor={colors.mutedText} style={[styles.input, styles.multiline]} testID="website-own-text" />
        </View>

        {!isNew && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={[styles.cardTitle, styles.flex1]}>Photos</Text>
              <Text style={styles.hint}>{sec.photos.length} / 24</Text>
            </View>
            <Text style={styles.hint}>Shown as a row customers can scroll; tapping one asks about it on WhatsApp. Add a caption to name the piece.</Text>
            <View style={o.grid}>
              {sec.photos.map((p) => (
                <View key={p.id} style={o.tile}>
                  <Image source={{ uri: abs(p.url, true) }} style={o.img} contentFit="cover" />
                  <Pressable onPress={() => removePhoto(p.id)} style={o.del} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove photo">
                    {busy === `del-${p.id}` ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="close" size={14} color="#fff" />}
                  </Pressable>
                  <TextInput value={captions[p.id] ?? ''} onChangeText={(t) => setCaptions((c) => ({ ...c, [p.id]: t }))} onBlur={() => saveCaption(p.id)}
                    placeholder="Caption" placeholderTextColor={colors.mutedText} style={o.caption} maxLength={80} />
                </View>
              ))}
              <Pressable onPress={addPhoto} disabled={busy === 'photo' || sec.photos.length >= 24} style={[o.tile, o.addTile]} testID="website-own-add-photo" accessibilityRole="button" accessibilityLabel="Add photo">
                {busy === 'photo' ? <ActivityIndicator color={colors.brandPrimary} /> : (
                  <><Ionicons name="add" size={26} color={colors.brandPrimary} /><Text style={styles.link}>Add photo</Text></>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {!isNew && (
          <Pressable onPress={removeSection} style={[styles.btn, { marginTop: spacing.lg }]} accessibilityRole="button" testID="website-own-delete">
            <Ionicons name="trash-outline" size={16} color={colors.onError} />
            <Text style={styles.danger}>Delete section</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={!dirty || busy === 'save'} style={[styles.primary, !dirty && { opacity: 0.5 }]} testID="website-own-save" accessibilityRole="button">
          {busy === 'save' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>{isNew ? 'Add section' : dirty ? 'Save changes' : 'Saved'}</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const ownStyles = (colors: ThemeColors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  img: { width: '100%', aspectRatio: 1, backgroundColor: colors.surfaceTertiary },
  del: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  caption: { minWidth: 0, width: '100%', color: colors.onSurface, fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 },
  addTile: { aspectRatio: 0.82, alignItems: 'center', justifyContent: 'center', gap: 4, borderStyle: 'dashed', borderColor: colors.brandPrimary },
});
