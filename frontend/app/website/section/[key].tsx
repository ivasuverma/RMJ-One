import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { Content, Header, PageSection, abs, makeStyles } from '../_shared';

// Edit one built-in part of rmj.co.in: its words (each can go back to the
// original), its photos, and — for most parts — whether it shows at all.
export default function WebsiteSectionScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [sec, setSec] = useState<PageSection | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback((c: Content) => {
    const s = c.page.find((p) => p.key === key) || null;
    setSec(s);
    setDraft(Object.fromEntries((s?.fields || []).map((f) => [f.key, f.value])));
  }, [key]);
  const load = useCallback(async () => {
    try { apply(await api.get<Content>('/website/content')); }
    catch (e: any) { toast.error(e?.detail || 'Could not load'); }
  }, [apply, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  if (!sec) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="website-section-screen">
        <Header title="Website" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const dirty = sec.fields.some((f) => (draft[f.key] ?? '') !== f.value);
  const save = () => run('save', async () => {
    const changed = Object.fromEntries(sec.fields.filter((f) => (draft[f.key] ?? '') !== f.value).map((f) => [f.key, draft[f.key] ?? '']));
    apply(await api.put<Content>('/website/content/texts', { texts: changed }));
    toast.success('Saved — live on rmj.co.in');
  });
  const setVisible = (v: boolean) => run('visible', async () => {
    await api.put(`/website/content/sections/${sec.key}/visible`, { visible: v });
    setSec({ ...sec, visible: v });
    toast.success(v ? 'Shown on the website' : 'Hidden from the website');
  });
  const changePhoto = async (imgKey: string) => {
    const file = await pickWebFile('image/*');
    if (!file) return;
    run(`img-${imgKey}`, async () => {
      const form = new FormData();
      form.append('file', file, file.name || 'photo.jpg');
      const r = await api.upload<{ url: string }>(`/website/content/images/${imgKey}`, form);
      setSec((s) => s && { ...s, images: s.images.map((i) => (i.key === imgKey ? { ...i, url: r.url, edited: true } : i)) });
      toast.success('Photo updated');
    });
  };
  const resetPhoto = (imgKey: string) => run(`img-${imgKey}`, async () => {
    const r = await api.del<{ url: string }>(`/website/content/images/${imgKey}`);
    setSec((s) => s && { ...s, images: s.images.map((i) => (i.key === imgKey ? { ...i, url: r.url, edited: false } : i)) });
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="website-section-screen">
      <Header title={sec.label} colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {sec.hideable && (
          <Pressable onPress={() => setVisible(!sec.visible)} disabled={busy === 'visible'} style={[styles.card, styles.row]} accessibilityRole="switch" accessibilityState={{ checked: sec.visible }} testID="website-section-visible">
            <View style={styles.flex1}>
              <Text style={styles.cardTitle}>Show on the website</Text>
              <Text style={styles.hint}>{sec.visible ? 'Visitors see this part of the page.' : 'Hidden — nothing here shows until you switch it back on.'}</Text>
            </View>
            <ToggleSwitch value={sec.visible} />
          </Pressable>
        )}

        {sec.pieces && (
          <Pressable onPress={() => router.push('/settings/website' as any)} style={[styles.card, styles.row]} accessibilityRole="button" testID="website-manage-pieces">
            <Ionicons name="diamond-outline" size={18} color={colors.brandSecondary} />
            <View style={styles.flex1}>
              <Text style={styles.cardTitle}>Pieces on the counter</Text>
              <Text style={styles.hint}>Add, reorder or hide the photos in this row.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
          </Pressable>
        )}

        {sec.images.map((img) => (
          <View key={img.key} style={styles.card} testID={`website-image-${img.key}`}>
            <Text style={styles.cardTitle}>{img.label}</Text>
            <Image source={{ uri: abs(img.url) }} style={styles.photo} contentFit="cover" />
            <View style={styles.row}>
              <Pressable onPress={() => changePhoto(img.key)} disabled={busy === `img-${img.key}`} style={[styles.btn, styles.flex1]} accessibilityRole="button">
                {busy === `img-${img.key}` ? <ActivityIndicator color={colors.brandSecondary} /> : (
                  <><Ionicons name="image-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Change photo</Text></>
                )}
              </Pressable>
              {img.edited && (
                <Pressable onPress={() => resetPhoto(img.key)} style={[styles.btn, styles.flex1]} accessibilityRole="button"><Text style={styles.btnText}>Use original</Text></Pressable>
              )}
            </View>
          </View>
        ))}

        {sec.fields.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Words</Text>
            {sec.fields.map((f) => {
              const v = draft[f.key] ?? '';
              const isOriginal = v.trim() === f.default || v.trim() === '';
              return (
                <View key={f.key} style={{ gap: 6, marginTop: 6 }}>
                  <View style={styles.row}>
                    <Text style={[styles.label, styles.flex1]}>{f.label}</Text>
                    {!isOriginal && (
                      <Pressable onPress={() => setDraft((d) => ({ ...d, [f.key]: f.default }))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Reset ${f.label} to the original`}>
                        <Text style={styles.link}>Use original</Text>
                      </Pressable>
                    )}
                  </View>
                  <TextInput value={v} onChangeText={(t) => setDraft((d) => ({ ...d, [f.key]: t }))} multiline={f.multiline}
                    placeholder={f.default} placeholderTextColor={colors.mutedText}
                    style={[styles.input, f.multiline && styles.multiline]} testID={`website-field-${f.key}`} />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {sec.fields.length > 0 && (
        <View style={styles.footer}>
          <Pressable onPress={save} disabled={!dirty || busy === 'save'} style={[styles.primary, !dirty && { opacity: 0.5 }]} testID="website-section-save" accessibilityRole="button">
            {busy === 'save' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>{dirty ? 'Save changes' : 'Saved'}</Text>}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
