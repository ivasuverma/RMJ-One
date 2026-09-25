import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Content, Header, OwnSection, PageSection, SITE_URL, makeStyles } from './_shared';

// Website — rmj.co.in laid out top to bottom, the way a visitor scrolls it.
// Tap a part to edit its words and photos (or switch it off); the shop's own
// sections sit between About and Visit and can be added, reordered and
// removed here. Changes show on the site the next time a page is opened.
export default function WebsiteScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const w = useMemo(() => webStyles(colors), [colors]);
  const toast = useToast();
  const [c, setC] = useState<Content | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setC(await api.get<Content>('/website/content')); }
    catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const move = async (i: number, dir: -1 | 1) => {
    if (!c) return;
    const list = [...c.sections];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setC({ ...c, sections: list });
    try { await api.put('/website/sections/order', { ids: list.map((s) => s.id) }); }
    catch (e: any) { toast.error(e?.detail || 'Could not reorder'); load(); }
  };

  const openSite = () => Linking.openURL(SITE_URL);

  if (!c) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="website-screen">
        <Header title="Website" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const builtinSub = (s: PageSection) => {
    if (!s.visible) return 'Hidden on the website';
    const edited = s.fields.filter((f) => f.edited).length + s.images.filter((i) => i.edited).length;
    const bits = [`${s.fields.length} text${s.fields.length === 1 ? '' : 's'}`];
    if (s.images.length) bits.push(`${s.images.length} photo${s.images.length === 1 ? '' : 's'}`);
    if (s.pieces) bits.push(`${c.pieces} pieces`);
    if (edited) bits.push(`${edited} changed`);
    return bits.join(' · ');
  };
  const ownSub = (s: OwnSection) => (s.visible ? `${s.photos.length} photo${s.photos.length === 1 ? '' : 's'}${s.text ? ' · text' : ''}` : 'Hidden on the website');

  const builtinRow = (s: PageSection) => (
    <Pressable key={s.key} onPress={() => router.push(`/website/section/${s.key}` as any)} style={[w.row, !s.visible && w.rowOff]} testID={`website-part-${s.key}`} accessibilityRole="button" accessibilityLabel={`${s.label}. ${builtinSub(s)}`}>
      <View style={w.icon}><Ionicons name={ICONS[s.key] || 'document-text-outline'} size={18} color={colors.brandSecondary} /></View>
      <View style={styles.flex1}>
        <Text style={w.rowTitle}>{s.label}</Text>
        <Text style={w.rowSub} numberOfLines={1}>{builtinSub(s)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
    </Pressable>
  );

  const aboutIdx = c.page.findIndex((s) => s.key === 'about');
  const before = c.page.slice(0, aboutIdx + 1);
  const after = c.page.slice(aboutIdx + 1);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="website-screen">
      <Header title="Website" colors={colors}
        right={<Pressable onPress={openSite} style={styles.iconBtn} hitSlop={12} accessibilityRole="link" accessibilityLabel="Open rmj.co.in"><Ionicons name="open-outline" size={18} color={colors.onSurface} /></Pressable>} />
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <Text style={styles.hint}>rmj.co.in from top to bottom. Tap a part to change its words or photos, or add your own section. Changes show on the site straight away.</Text>

        <Pressable onPress={() => router.push('/website/brand' as any)} style={w.row} testID="website-brand" accessibilityRole="button" accessibilityLabel="Logo and name size">
          <View style={w.icon}><Ionicons name="resize-outline" size={18} color={colors.brandSecondary} /></View>
          <View style={styles.flex1}>
            <Text style={w.rowTitle}>Logo & name size</Text>
            <Text style={w.rowSub}>Logo {c.brand?.logo ?? 100}% · Name {c.brand?.name ?? 85}%</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {before.map(builtinRow)}

        <Text style={w.groupLabel}>Your sections</Text>
        {c.sections.map((s, i) => (
          <View key={s.id} style={[w.row, !s.visible && w.rowOff]}>
            <Pressable onPress={() => router.push(`/website/custom/${s.id}` as any)} style={[styles.row, styles.flex1]} testID={`website-own-${i}`} accessibilityRole="button" accessibilityLabel={`${s.title}. ${ownSub(s)}`}>
              <View style={w.icon}><Ionicons name="albums-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={styles.flex1}>
                <Text style={w.rowTitle} numberOfLines={1}>{s.title}</Text>
                <Text style={w.rowSub}>{ownSub(s)}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={[w.arrow, i === 0 && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Move up">
              <Ionicons name="chevron-up" size={16} color={colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === c.sections.length - 1} hitSlop={6} style={[w.arrow, i === c.sections.length - 1 && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Move down">
              <Ionicons name="chevron-down" size={16} color={colors.onSurface} />
            </Pressable>
          </View>
        ))}
        <Pressable onPress={() => router.push('/website/custom/new' as any)} style={w.add} testID="website-add-section" accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
          <Text style={[styles.link, { fontSize: 14 }]}>Add a section</Text>
        </Pressable>
        <Text style={[styles.hint, { marginTop: 4 }]}>New sections appear after “About”, with a heading, text and a row of photos customers can ask about on WhatsApp.</Text>

        <View style={{ height: spacing.md }} />
        {after.map(builtinRow)}
      </ScrollView>
    </SafeAreaView>
  );
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  hero: 'trending-up-outline', showcase: 'image-outline', collections: 'grid-outline',
  counter: 'diamond-outline', about: 'people-outline', visit: 'location-outline',
};

const webStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  rowOff: { opacity: 0.55 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.onSurface, fontSize: 14.5, fontWeight: '700' },
  rowSub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  groupLabel: { color: colors.brandSecondary, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.lg },
  arrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm, paddingVertical: 14,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.brandPrimary,
  },
});
