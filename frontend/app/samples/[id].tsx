import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/auth/AuthContext';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { confirmAction } from '@/src/utils/confirm';
import { istDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; pc_count?: number; issue_type?: string; due_date: string | null;
  photo: string; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received';
  received_weight: number | null; weight_diff: number | null;
  issued_at: string; issued_by: string; received_at: string | null; received_by: string | null;
  note: string;
};

export default function SampleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canEdit = hasRight('samples', 'edit');
  const canDelete = hasRight('samples', 'delete');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try { setError(''); setSample(await api.get<Sample>(`/samples/${id}`)); }
    catch (e: any) { setError(e?.detail || 'Failed to load sample'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printThermal = async () => {
    setPrinting(true);
    try { await api.post(`/samples/${id}/issue-slip/print`, {}); }
    catch (e: any) { notify('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
    finally { setPrinting(false); }
  };

  const [printingPdf, setPrintingPdf] = useState(false);
  const printPdf = async () => {
    setPrintingPdf(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/samples/${id}/issue-slip/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Print failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        notify('Ready', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { notify('Failed', e?.message || 'Please try again'); }
    finally { setPrintingPdf(false); }
  };

  const remove = () => {
    if (!sample) return;
    confirmAction(
      'Delete sample?',
      `Remove ${sample.sample_code}? This also undoes its effect on ${sample.karigar_name}'s gold balance. This cannot be undone.`,
      'Delete',
      async () => {
        setDeleting(true);
        try { await api.del(`/samples/${id}`); router.back(); }
        catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
        finally { setDeleting(false); }
      },
    );
  };

  if (loading || !sample) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <View style={{ padding: spacing.lg }}><ErrorState message={error || 'Sample not found'} onRetry={load} testID="sample-detail-error" /></View>
        )}
      </SafeAreaView>
    );
  }

  const isWithKarigar = sample.status === 'with_karigar';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{sample.sample_code}</Text>
        {isWithKarigar && canEdit && (
          <Pressable onPress={() => router.push(`/samples/new?id=${sample.id}` as any)} style={styles.iconBtn} testID="edit-sample-btn" hitSlop={12}>
            <Ionicons name="pencil-outline" size={18} color={colors.onSurface} />
          </Pressable>
        )}
        {canDelete && (
          <Pressable onPress={remove} disabled={deleting} style={styles.iconBtn} testID="delete-sample-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.badge, isWithKarigar ? styles.badgeOut : styles.badgeReceived, { alignSelf: 'flex-start' }]}>
            <Text style={[styles.badgeText, isWithKarigar ? styles.badgeTextOut : styles.badgeTextReceived]}>
              {isWithKarigar ? 'With Karigar' : 'Received'}
            </Text>
          </View>

          {sample.photo ? <Image source={{ uri: sample.photo }} style={styles.photo} /> : null}

          <RecordPhotos refType="sample" refId={sample.id} label="Photos" />

          <Text style={styles.description}>{sample.description}</Text>
          {!!sample.tag_number && <Text style={styles.tagNumber}>Tag {sample.tag_number}</Text>}

          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{sample.weight.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Issued weight</Text>
            </View>
            {sample.status === 'received' && (
              <View style={styles.summaryTile}>
                <Text style={styles.summaryValue}>{sample.received_weight?.toFixed(3)}g</Text>
                <Text style={styles.summaryLabel}>Received weight</Text>
              </View>
            )}
          </View>
          {sample.status === 'received' && !!sample.weight_diff && (
            <View style={styles.diffTile}>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>{sample.weight_diff > 0 ? '+' : ''}{sample.weight_diff.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Difference vs issued</Text>
            </View>
          )}

          <View style={styles.detailCard}>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Karigar</Text><Text style={styles.detailValue}>{sample.karigar_name}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Pieces</Text><Text style={styles.detailValue}>{sample.pc_count ?? 1}</Text></View>
            {!!sample.issue_type && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Issue Type</Text><Text style={styles.detailValue}>{sample.issue_type}</Text></View>
            )}
            {!!sample.due_date && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Due Back</Text><Text style={styles.detailValue}>{sample.due_date}</Text></View>
            )}
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Issued</Text><Text style={styles.detailValue}>{istDateTime(sample.issued_at)} · {sample.issued_by}</Text></View>
            {sample.received_at && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Received</Text><Text style={styles.detailValue}>{istDateTime(sample.received_at)} · {sample.received_by}</Text></View>
            )}
            {!!sample.note && (
              <View style={[styles.detailRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 4 }]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue}>{sample.note}</Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={printPdf} disabled={printingPdf} style={[styles.actionBtn, { flex: 1 }]} testID="print-sample-issue-slip-pdf-btn">
              {printingPdf ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print PDF</Text></>}
            </Pressable>
            <Pressable onPress={printThermal} disabled={printing} style={[styles.actionBtn, { flex: 1 }]} testID="print-sample-issue-slip-btn">
              {printing ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Receipt</Text></>}
            </Pressable>
          </View>

          {isWithKarigar && (
            <Pressable style={styles.primaryBtn} onPress={() => router.push(`/samples/receive?id=${id}` as any)} testID="open-receive-sample-btn">
              <Text style={styles.primaryBtnText}>Receive Back</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, marginBottom: spacing.md },
  badgeOut: { backgroundColor: colors.brandTertiary },
  badgeReceived: { backgroundColor: colors.success },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOut: { color: colors.brandSecondary },
  badgeTextReceived: { color: colors.onSuccess },

  photo: { width: '100%', height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, marginBottom: spacing.md },
  description: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display },
  tagNumber: { color: colors.mutedText, fontSize: 13, marginTop: 2, marginBottom: spacing.md },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  diffTile: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  summaryValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md, marginBottom: spacing.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: colors.mutedText, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  actionBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, marginTop: spacing.lg,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
});
