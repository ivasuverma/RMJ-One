import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; purity: number;
  gross_weight: number; fine_weight: number; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received';
  received_weight: number | null; received_fine_weight: number | null; weight_diff: number | null;
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
  const [showReceive, setShowReceive] = useState(false);
  const [receivedWeight, setReceivedWeight] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try { setSample(await api.get<Sample>(`/samples/${id}`)); }
    catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const receive = async () => {
    const w = parseFloat(receivedWeight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter the weight received back'); return; }
    setReceiving(true);
    try {
      await api.post(`/samples/${id}/receive`, { received_weight: w, note: receiveNote.trim() });
      setShowReceive(false); setReceivedWeight(''); setReceiveNote('');
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setReceiving(false); }
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
        catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
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
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
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

          <Text style={styles.description}>{sample.description}</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{sample.gross_weight.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Issued weight</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{sample.purity}%</Text>
              <Text style={styles.summaryLabel}>Purity</Text>
            </View>
          </View>

          {sample.status === 'received' && (
            <View style={styles.summaryRow}>
              <View style={styles.summaryTile}>
                <Text style={styles.summaryValue}>{sample.received_weight?.toFixed(3)}g</Text>
                <Text style={styles.summaryLabel}>Received weight</Text>
              </View>
              <View style={styles.summaryTile}>
                <Text style={[styles.summaryValue, !!sample.weight_diff && { color: colors.onWarning }]}>
                  {sample.weight_diff ? `${sample.weight_diff > 0 ? '+' : ''}${sample.weight_diff.toFixed(3)}g` : 'Exact'}
                </Text>
                <Text style={styles.summaryLabel}>Difference</Text>
              </View>
            </View>
          )}

          <View style={styles.detailCard}>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Karigar</Text><Text style={styles.detailValue}>{sample.karigar_name}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Issued</Text><Text style={styles.detailValue}>{sample.issued_at?.slice(0, 10)} · {sample.issued_by}</Text></View>
            {sample.received_at && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Received</Text><Text style={styles.detailValue}>{sample.received_at.slice(0, 10)} · {sample.received_by}</Text></View>
            )}
            {!!sample.note && (
              <View style={[styles.detailRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 4 }]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue}>{sample.note}</Text>
              </View>
            )}
          </View>

          {isWithKarigar && canEdit && !showReceive && (
            <Pressable style={styles.primaryBtn} onPress={() => setShowReceive(true)} testID="open-receive-sample-btn">
              <Text style={styles.primaryBtnText}>Receive Back</Text>
            </Pressable>
          )}

          {isWithKarigar && showReceive && (
            <View style={styles.formCard} testID="receive-sample-form">
              <Text style={styles.formHeaderText}>Receive Sample</Text>
              <Text style={styles.formHint}>Expected {sample.gross_weight.toFixed(3)}g back — enter what actually came back.</Text>
              <Text style={styles.label}>Received weight (g)</Text>
              <TextInput
                testID="received-weight" value={receivedWeight} onChangeText={setReceivedWeight}
                keyboardType="decimal-pad" placeholder={sample.gross_weight.toFixed(3)}
                placeholderTextColor={colors.mutedText} style={styles.input}
              />
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                testID="receive-note" value={receiveNote} onChangeText={setReceiveNote}
                placeholder="Anything worth noting about the return" placeholderTextColor={colors.mutedText}
                style={styles.input} multiline
              />
              <Pressable style={[styles.primaryBtn, receiving && { opacity: 0.6 }]} disabled={receiving} onPress={receive} testID="confirm-receive-sample-btn">
                {receiving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Confirm Receipt</Text>}
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowReceive(false)} testID="cancel-receive-sample-btn">
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
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

  description: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display, marginBottom: spacing.md },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: colors.mutedText, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  formHint: { color: colors.mutedText, fontSize: 11, marginTop: 4, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  secondaryBtn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  secondaryBtnText: { color: colors.mutedText, fontWeight: '700', fontSize: 13 },
});
