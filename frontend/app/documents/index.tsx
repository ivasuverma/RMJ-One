import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { istTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { DocumentCaptureSheet } from '@/src/components/DocumentCaptureSheet';

// Documents module — Phase 2: capture + a Pending worklist preview. The full
// Pending/Done segmented worklist and Record→Done flow land in Phase 3; this
// screen already lists what's been captured so capture is testable end-to-end.
type Doc = {
  id: string; category_key: string; status: 'pending' | 'done'; upload_state: string;
  file: { mime: string; orig_name: string }; note?: string; created_at: string;
};
type Cat = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap };
type Summary = { pending_count: number; done_count: number; uploading_count: number };

export default function DocumentsScreen() {
  const router = useRouter();
  const { capture } = useLocalSearchParams<{ capture?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cats, setCats] = useState<Record<string, Cat>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [token, setToken] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(capture === '1');

  const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const load = useCallback(async () => {
    setToken((await storage.secureGet<string>(TOKEN_KEY, '')) || '');
    api.get<Cat[]>('/document-categories').then((cs) => setCats(Object.fromEntries(cs.map((c) => [c.key, c])))).catch(() => {});
    api.get<Summary>('/documents/summary').then(setSummary).catch(() => {});
    api.get<Doc[]>('/documents?status=pending').then(setDocs).catch(() => setDocs([]));
    setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="documents-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8} testID="back-btn">
          <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
          <Text style={styles.backText}>Work</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Documents</Text>
            <Text style={styles.sub}>Snap · record · filed &amp; searchable.</Text>
          </View>
          <View style={styles.drivePill}>
            {summary && summary.uploading_count > 0 ? (
              <><Ionicons name="cloud-upload-outline" size={13} color={colors.onWarning} /><Text style={[styles.drivePillText, { color: colors.onWarning }]}>{summary.uploading_count} uploading</Text></>
            ) : (
              <><Ionicons name="cloud-done-outline" size={13} color={colors.onSuccess} /><Text style={[styles.drivePillText, { color: colors.onSuccess }]}>Local</Text></>
            )}
          </View>
        </View>

        <Pressable onPress={() => setCaptureOpen(true)} style={styles.addBtn} testID="documents-add-btn">
          <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.addBtnText}>Add document</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Pending · {summary?.pending_count ?? docs.length}</Text>
        {docs.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={34} color={colors.mutedText} />
            <Text style={styles.emptyText}>Nothing pending — all slips recorded.</Text>
          </View>
        ) : docs.map((d) => (
          <View key={d.id} style={styles.row} testID={`doc-${d.id}`}>
            <View style={styles.thumb}>
              {(d.file.mime || '').startsWith('image/') && token ? (
                <Image source={{ uri: `${base}/api/documents/${d.id}/file`, headers: { Authorization: `Bearer ${token}` } }} style={styles.thumbImg} contentFit="cover" />
              ) : (
                <Ionicons name="document-text-outline" size={22} color={colors.brandSecondary} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.docName} numberOfLines={1}>{d.note || d.file.orig_name}</Text>
              <Text style={styles.docMeta} numberOfLines={1}>
                {cats[d.category_key]?.label || d.category_key} · {istTime(d.created_at)}
                {d.upload_state === 'queued' || d.upload_state === 'uploading' ? ' · uploading' : ''}
              </Text>
            </View>
          </View>
        ))}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <DocumentCaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} onSaved={load} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '500' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  h1: { color: colors.onSurface, fontSize: 32, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.6 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  drivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  drivePillText: { fontSize: 12, fontWeight: '700' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
  },
  addBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  sectionLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: 10,
  },
  thumb: { width: 46, height: 46, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: 46, height: 46 },
  docName: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  docMeta: { color: colors.mutedText, fontSize: 12.5, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
