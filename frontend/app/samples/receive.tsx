import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; karigar_name: string; status: 'with_karigar' | 'received';
};

export default function ReceiveSampleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(true);
  const [receivedWeight, setReceivedWeight] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const s = await api.get<Sample>(`/samples/${id}`);
      setSample(s);
      // Prefilled with the issued weight rather than left blank behind a
      // placeholder — a matching return is the common case, and a greyed-out
      // placeholder that happens to equal the issued weight above it reads,
      // at a glance, exactly like an already-entered value. Staff would tap
      // Confirm on an actually-empty field, and since Alert.alert is a
      // total no-op on web (see src/utils/notify.ts), the validation error
      // never appeared either — the button just looked dead.
      setReceivedWeight(String(s.weight));
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (submittingRef.current || !sample) return;
    const w = parseFloat(receivedWeight);
    if (!w || w <= 0) { notify('Missing', 'Enter the weight received back'); return; }
    submittingRef.current = true;
    setBusy(true);
    try {
      await api.post(`/samples/${sample.id}/receive`, { received_weight: w, note: note.trim() });
      router.back();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  if (loading || !sample) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const w = parseFloat(receivedWeight) || 0;
  const diff = receivedWeight ? Math.round((w - sample.weight) * 1000) / 1000 : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="receive-sample-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Receive Sample</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.pickedCard}>
            <Text style={styles.cName}>{sample.sample_code}{sample.tag_number ? ` · Tag ${sample.tag_number}` : ''} · {sample.description}</Text>
            <Text style={styles.cMeta}>with {sample.karigar_name}</Text>
          </View>

          {sample.status !== 'with_karigar' ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>This sample has already been received back.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Issued weight (g)</Text>
              <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{sample.weight.toFixed(3)}</Text></View>

              <Text style={styles.label}>Received weight (g)</Text>
              <TextInput
                testID="received-weight" value={receivedWeight}
                onChangeText={(v) => setReceivedWeight(v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad" placeholder="0.000"
                placeholderTextColor={colors.mutedText} style={styles.input}
              />

              {!!receivedWeight && (
                <Text style={[styles.diffHint, diff !== 0 && { color: diff > 0 ? colors.onWarning : colors.onSuccess }]}>
                  {diff === 0 ? 'Matches the issued weight exactly.' : `${diff > 0 ? '+' : ''}${diff.toFixed(3)}g vs issued — expected the same weight back.`}
                </Text>
              )}

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                testID="receive-note" value={note} onChangeText={setNote}
                placeholder="Anything worth noting about the return" placeholderTextColor={colors.mutedText}
                style={styles.input} multiline
              />

              <Pressable
                style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy}
                onPress={submit} testID="confirm-receive-sample-btn"
              >
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Confirm Receipt</Text>}
              </Pressable>
            </>
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

  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  readonlyBox: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  readonlyBoxText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  diffHint: { color: colors.mutedText, fontSize: 12, marginTop: spacing.sm },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
