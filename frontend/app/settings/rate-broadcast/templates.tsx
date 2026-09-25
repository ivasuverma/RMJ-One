import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Header, makeStyles, Overview, Tpl, templateLine } from './_shared';

const BUTTON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'See live rates': 'open-outline', 'Call the shop': 'call-outline', 'Weekly only': 'calendar-outline', 'Stop updates': 'arrow-undo-outline',
};

// Step 2 — message templates. Meta delivers a business-started message only
// through a template it has approved; the text and buttons are fixed by the
// template, the photo on top can change any time.
export default function BroadcastTemplatesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useMemo(() => tplStyles(colors), [colors]);
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setOv(await api.get<Overview>('/rate-broadcast/overview')); }
    catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  const createTemplate = () => run('tpl', async () => {
    const tpl = await api.post<Tpl>('/rate-broadcast/template', {});
    setOv((o) => (o ? { ...o, template: tpl } : o));
    toast.success('Sent to Meta for approval');
  });
  const changePhoto = async () => {
    const file = await pickWebFile('image/*');
    if (!file) return;
    run('photo', async () => {
      const form = new FormData();
      form.append('file', file, file.name || 'photo.jpg');
      const r = await api.upload<{ photo_url: string; photo_custom: boolean }>('/rate-broadcast/photo', form);
      setOv((o) => (o ? { ...o, ...r } : o));
      toast.success('Photo updated — used from the next send');
    });
  };
  const resetPhoto = () => run('photo', async () => {
    const r = await api.del<{ photo_url: string; photo_custom: boolean }>('/rate-broadcast/photo');
    setOv((o) => (o ? { ...o, ...r } : o));
  });

  if (!ov) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-templates-screen">
        <Header title="Templates" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }
  const tpl = ov.template;
  const approved = tpl.status === 'APPROVED';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-templates-screen">
      <Header title="Templates" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <Text style={styles.hint}>
          Meta only delivers messages you start through a template it has approved. The text and buttons are fixed once
          approved; the photo on top can change any time.
        </Text>

        <View style={styles.card} testID="broadcast-template-rate">
          <View style={styles.row}>
            <Text style={[styles.cardTitle, styles.flex1]}>Rate update</Text>
            <View style={[t.badge, approved ? styles.ok : styles.warn]}>
              <Text style={[t.badgeText, { color: approved ? colors.onSuccess : colors.onWarning }]}>{approved ? 'Approved' : tpl.exists ? (tpl.status || 'Pending') : 'Not created'}</Text>
            </View>
          </View>
          <Text style={styles.listMeta}>Marketing · today’s gold & silver rate, sent daily or weekly</Text>

          <View style={t.bubble} testID="rate-broadcast-preview">
            <Image source={{ uri: ov.photo_url }} style={t.photo} contentFit="cover" />
            <Text style={t.bubbleText}>{ov.preview}</Text>
            {ov.buttons.map((b) => (
              <View key={b} style={t.waButton}>
                <Ionicons name={BUTTON_ICONS[b] || 'ellipse-outline'} size={15} color="#1B8AD8" />
                <Text style={t.waButtonText}>{b}</Text>
              </View>
            ))}
          </View>

          <View style={styles.row}>
            <Pressable onPress={changePhoto} disabled={busy === 'photo'} style={[styles.btn, styles.flex1]} testID="rate-broadcast-change-photo" accessibilityRole="button">
              {busy === 'photo' ? <ActivityIndicator color={colors.brandSecondary} /> : (
                <><Ionicons name="image-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Change photo</Text></>
              )}
            </Pressable>
            {ov.photo_custom && (
              <Pressable onPress={resetPhoto} style={[styles.btn, styles.flex1]} accessibilityRole="button"><Text style={styles.btnText}>Use shop photo</Text></Pressable>
            )}
          </View>

          <View style={[styles.status, approved ? styles.ok : styles.warn]} testID="rate-broadcast-template-status">
            <Ionicons name={approved ? 'checkmark-circle-outline' : 'time-outline'} size={16} color={approved ? colors.onSuccess : colors.onWarning} />
            <Text style={[styles.statusText, { color: approved ? colors.onSuccess : colors.onWarning }]}>{templateLine(ov)}</Text>
          </View>
          {!tpl.exists && ov.meta_configured ? (
            <Pressable onPress={createTemplate} disabled={busy === 'tpl'} style={styles.primary} testID="rate-broadcast-create-template" accessibilityRole="button">
              {busy === 'tpl' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Create template</Text>}
            </Pressable>
          ) : !approved && ov.meta_configured ? (
            <Pressable onPress={load} style={styles.btn} accessibilityRole="button"><Text style={styles.btnText}>Check status</Text></Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const tplStyles = (colors: ThemeColors) => StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11.5, fontWeight: '800' },
  bubble: { backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, maxWidth: 340, width: '100%', alignSelf: 'center', marginVertical: 4 },
  photo: { width: '100%', aspectRatio: 1.6, backgroundColor: colors.surfaceTertiary },
  bubbleText: { color: '#111B21', fontSize: 13.5, lineHeight: 19, padding: 10 },
  waButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D1D7DB' },
  waButtonText: { color: '#1B8AD8', fontSize: 14, fontWeight: '600' },
});
