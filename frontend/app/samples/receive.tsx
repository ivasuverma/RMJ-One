import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; karigar_name: string; status: 'with_karigar' | 'received';
  received_weight: number | null; note: string;
  pay_weight?: number | null; recv_weight?: number | null; write_off_loss?: boolean;
};

// How a shortfall/surplus vs. the issued weight gets handled — mutually
// exclusive, matching the three things the backend actually does with it.
type GapChoice = 'carry' | 'settle' | 'loss';

function round3(n: number) { return Math.round(n * 1000) / 1000; }

// Same form for both creating and correcting a receive — reused rather than
// a separate edit screen (mirrors repairs/item/receive.tsx's isEdit pattern).
// A sample can only ever have one receive on it, so "editing" just means
// this sample is already 'received': the backend's PUT (not POST) redoes
// the whole ledger footprint from scratch against the corrected numbers.
export default function ReceiveSampleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(true);
  const [receivedWeight, setReceivedWeight] = useState('');
  const [gapChoice, setGapChoice] = useState<GapChoice>('carry');
  const [payWeight, setPayWeight] = useState('');
  const [recvWeight, setRecvWeight] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const s = await api.get<Sample>(`/samples/${id}`);
      setSample(s);
      const isEdit = s.status === 'received';
      // Prefilled with the issued (or, when editing, the already-recorded
      // received) weight rather than left blank behind a placeholder — a
      // matching return is the common case, and a greyed-out placeholder
      // that happens to equal the weight above it reads, at a glance,
      // exactly like an already-entered value.
      setReceivedWeight(String(isEdit ? s.received_weight ?? s.weight : s.weight));
      setPayWeight(isEdit && s.pay_weight ? String(s.pay_weight) : '');
      setRecvWeight(isEdit && s.recv_weight ? String(s.recv_weight) : '');
      setGapChoice(isEdit && s.write_off_loss ? 'loss' : isEdit && (s.pay_weight || s.recv_weight) ? 'settle' : 'carry');
      setNote(isEdit ? (s.note || '') : '');
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isEdit = sample?.status === 'received';

  const submit = async () => {
    if (submittingRef.current || !sample) return;
    const w = parseFloat(receivedWeight);
    if (!w || w <= 0) { notify('Missing', 'Enter the weight received back'); return; }
    submittingRef.current = true;
    setBusy(true);
    try {
      const payload = {
        received_weight: w, note: note.trim(),
        pay_weight: gapChoice === 'settle' ? parseFloat(payWeight) || 0 : 0,
        recv_weight: gapChoice === 'settle' ? parseFloat(recvWeight) || 0 : 0,
        write_off_loss: gapChoice === 'loss',
      };
      if (isEdit) await api.put(`/samples/${sample.id}/receive`, payload);
      else await api.post(`/samples/${sample.id}/receive`, payload);
      router.back();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const removeReceive = () => {
    if (!sample) return;
    confirmAction(
      'Undo this receive?',
      `${sample.sample_code} goes back to "With Karigar", and everything this receive posted to ${sample.karigar_name}'s gold balance is removed. This cannot be undone.`,
      'Undo Receive',
      async () => {
        setDeleting(true);
        try { await api.del(`/samples/${sample.id}/receive`); router.back(); }
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
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const w = parseFloat(receivedWeight) || 0;
  const diff = receivedWeight ? round3(w - sample.weight) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="receive-sample-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? 'Edit Receive' : 'Receive Sample'}</Text>
        {isEdit ? (
          <Pressable onPress={removeReceive} disabled={deleting} style={styles.iconBtn} testID="delete-receive-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.pickedCard}>
            <Text style={styles.cName}>{sample.sample_code}{sample.tag_number ? ` · Tag ${sample.tag_number}` : ''} · {sample.description}</Text>
            <Text style={styles.cMeta}>with {sample.karigar_name}</Text>
          </View>

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

          {/* Only when there's a gap — an exact match just posts the plain
              receive entry above, nothing to choose. */}
          {diff !== 0 && (
            <>
              <Text style={styles.label}>How to handle the gap</Text>
              <View style={styles.gapChoiceRow}>
                <Pressable onPress={() => setGapChoice('carry')} style={[styles.gapChip, gapChoice === 'carry' && styles.gapChipActive]} testID="gap-choice-carry">
                  <Text style={[styles.gapChipText, gapChoice === 'carry' && styles.gapChipTextActive]}>Carry Balance</Text>
                </Pressable>
                <Pressable onPress={() => setGapChoice('settle')} style={[styles.gapChip, gapChoice === 'settle' && styles.gapChipActive]} testID="gap-choice-settle">
                  <Text style={[styles.gapChipText, gapChoice === 'settle' && styles.gapChipTextActive]}>Settle Now</Text>
                </Pressable>
                {diff < 0 && (
                  <Pressable onPress={() => setGapChoice('loss')} style={[styles.gapChip, gapChoice === 'loss' && styles.gapChipActive]} testID="gap-choice-loss">
                    <Text style={[styles.gapChipText, gapChoice === 'loss' && styles.gapChipTextActive]}>Write Off as Loss</Text>
                  </Pressable>
                )}
              </View>

              {gapChoice === 'carry' && (
                <Text style={styles.diffHint}>The gap sits on {sample.karigar_name}&apos;s running balance until settled later.</Text>
              )}

              {gapChoice === 'settle' && (
                <View style={styles.settleRow}>
                  <View style={styles.fieldColFlex}>
                    <Text style={styles.label}>Pay (g)</Text>
                    <TextInput
                      testID="pay-weight" value={payWeight}
                      onChangeText={(v) => setPayWeight(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad" placeholder="0.000"
                      placeholderTextColor={colors.mutedText} style={styles.input}
                    />
                    <Text style={styles.settleHint}>Extra gold you hand the karigar</Text>
                  </View>
                  <View style={styles.fieldColFlex}>
                    <Text style={styles.label}>Receive (g)</Text>
                    <TextInput
                      testID="recv-weight" value={recvWeight}
                      onChangeText={(v) => setRecvWeight(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad" placeholder="0.000"
                      placeholderTextColor={colors.mutedText} style={styles.input}
                    />
                    <Text style={styles.settleHint}>Extra gold the karigar hands you</Text>
                  </View>
                </View>
              )}

              {gapChoice === 'loss' && (
                <Text style={styles.diffHint}>
                  {Math.abs(diff).toFixed(3)}g is written off as a forgiven process loss — it shows up on the Loss Ledger and doesn&apos;t count against {sample.karigar_name}&apos;s balance.
                </Text>
              )}
            </>
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
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{isEdit ? 'Save Changes' : 'Confirm Receipt'}</Text>}
          </Pressable>
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

  gapChoiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gapChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  gapChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  gapChipText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '700' },
  gapChipTextActive: { color: colors.onBrandPrimary },

  settleRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  fieldColFlex: { flex: 1 },
  settleHint: { color: colors.mutedText, fontSize: 10.5, marginTop: 4 },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
