import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Brand, Content, Header, SITE_URL, makeStyles } from './_shared';

// Logo & name size on rmj.co.in — how big the logo and the RAMMURTI
// JEWELLERS name are in the site's header (the footer and the other places
// they appear follow in proportion). Stored as % of the built-in size;
// the site applies them as CSS scales (website/index.html, --logo-scale /
// --name-scale). Backend: PUT /website/content/brand.
const STEP = 5;
const HEADER_H = 46;     // the header's logo height at 100% (px on the site)
const GOLD = '#D2A551';

export default function WebsiteBrandScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const b = useMemo(() => brandStyles(colors), [colors]);
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [saved, setSaved] = useState<Brand | null>(null);
  const [val, setVal] = useState<Brand | null>(null);
  const [defaults, setDefaults] = useState<Brand>({ logo: 100, name: 85 });
  const [range, setRange] = useState<[number, number]>([60, 140]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.get<Content>('/website/content');
      setSaved(c.brand); setVal(c.brand); setDefaults(c.brand_default); setRange(c.brand_range);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!val) return;
    setBusy(true);
    try {
      const c = await api.put<Content>('/website/content/brand', val);
      setSaved(c.brand);
      toast.success('Saved — the website shows the new size on the next page load');
      router.back();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(false); }
  };

  if (!val || !saved) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="website-brand-screen">
        <Header title="Logo & name size" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const [lo, hi] = range;
  const set = (k: keyof Brand, v: number) => setVal((x) => x && { ...x, [k]: Math.max(lo, Math.min(hi, v)) });
  const changed = val.logo !== saved.logo || val.name !== saved.name;
  const isDefault = val.logo === defaults.logo && val.name === defaults.name;

  // Preview at the site's real proportions, scaled down only if it wouldn't fit this screen.
  const lockupW = HEADER_H * (val.logo / 100) * 1.36 + HEADER_H * 4.12 * (val.name / 100);
  const k = Math.min(1, (width - spacing.lg * 2 - 64) / lockupW);
  const logoH = HEADER_H * (val.logo / 100) * k;
  const nameW = HEADER_H * 4.12 * (val.name / 100) * k;

  const stepper = (key: keyof Brand, label: string, hint: string) => (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.flex1}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
        <Pressable onPress={() => set(key, val[key] - STEP)} disabled={val[key] <= lo} style={[b.step, val[key] <= lo && b.off]}
          accessibilityRole="button" accessibilityLabel={`${label} smaller`} testID={`brand-${key}-minus`}>
          <Ionicons name="remove" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={b.pct} testID={`brand-${key}-value`}>{val[key]}%</Text>
        <Pressable onPress={() => set(key, val[key] + STEP)} disabled={val[key] >= hi} style={[b.step, val[key] >= hi && b.off]}
          accessibilityRole="button" accessibilityLabel={`${label} bigger`} testID={`brand-${key}-plus`}>
          <Ionicons name="add" size={20} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="website-brand-screen">
      <Header title="Logo & name size" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>How big the logo and the RAMMURTI JEWELLERS name look at the top of rmj.co.in. The footer and other places follow in proportion.</Text>

        <View style={b.band} testID="brand-preview">
          <View style={b.lockup}>
            <Image source={{ uri: `${SITE_URL}/assets/images/logo-tile.webp` }} style={{ height: logoH, width: logoH * 0.934 }} contentFit="contain" />
            <Image source={{ uri: `${SITE_URL}/assets/images/wordmark.png` }} tintColor={GOLD}
              style={{ width: nameW, height: nameW * 0.22, marginLeft: HEADER_H * 0.36 * (val.logo / 100) * k }} contentFit="fill" />
          </View>
          <Ionicons name="menu" size={24} color="#F5F5F7" />
        </View>
        <Text style={[styles.hint, { textAlign: 'center' }]}>Preview of the website’s top bar</Text>

        {stepper('logo', 'Logo', `Default ${defaults.logo}%`)}
        {stepper('name', 'Name', `Default ${defaults.name}%`)}

        {!isDefault && (
          <Pressable onPress={() => setVal(defaults)} style={[styles.btn, { marginTop: spacing.md }]} accessibilityRole="button" testID="brand-reset">
            <Text style={styles.btnText}>Back to default sizes</Text>
          </Pressable>
        )}
        <Pressable onPress={save} disabled={!changed || busy} style={[styles.primary, { marginTop: spacing.md }, !changed && { opacity: 0.5 }]}
          accessibilityRole="button" testID="brand-save">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const brandStyles = (colors: ThemeColors) => StyleSheet.create({
  band: {
    height: 72, backgroundColor: '#000', borderRadius: radius.md, marginTop: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, overflow: 'hidden',
  },
  lockup: { flexDirection: 'row', alignItems: 'center' },
  step: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  off: { opacity: 0.35 },
  pct: { minWidth: 56, textAlign: 'center', color: colors.onSurface, fontSize: 17, fontWeight: '800' },
});
