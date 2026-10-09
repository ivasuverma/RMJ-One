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
import { istDateTime } from '@/src/utils/datetime';
import { Part, partsSummary } from '@/src/utils/samples';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Image } from 'expo-image';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { GlassButton } from '@/src/components/ui/GlassButton';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { makeThumbFromDataUri } from '@/src/utils/imageThumb';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; karigar_name: string; status: 'with_karigar' | 'received';
  photo?: string;   // older samples kept their photo inline; newer ones use record photos
  issue_type?: string; purity?: number | null; pc_count?: number;
  received_weight: number | null; note: string;
  pay_weight?: number | null; recv_weight?: number | null; write_off_loss?: boolean;
  final_received_weight?: number | null; partial_receipts?: Part[];
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
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'all' | 'part'>('all');
  const [partWeight, setPartWeight] = useState('');
  const [partPcs, setPartPcs] = useState('');
  const [deleting, setDeleting] = useState(false);
  // An optional photo of what came back (only issuing needs one).
  const [photo, setPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const savePhoto = async (sid: string) => {
    if (!photo) return;
    try {
      const full = await (await fetch(photo)).blob();
      const thumb = await makeThumbFromDataUri(photo);
      const pid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}`;
      await enqueueRecordPhoto({ id: pid, blob: full, filename: `sample-received-${sid}.jpg`, thumb, ref_type: 'sample_receive', ref_id: sid });
    } catch { /* the upload queue retries; don't block the receive */ }
  };
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
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
      const out = partsSummary(s).outW;
      setReceivedWeight(String(isEdit ? s.final_received_weight ?? s.received_weight ?? out : out));
      setMode('all'); setPartWeight(''); setPartPcs('');
      setPayWeight(isEdit && s.pay_weight ? String(s.pay_weight) : '');
      setRecvWeight(isEdit && s.recv_weight ? String(s.recv_weight) : '');
      setGapChoice(isEdit && s.write_off_loss ? 'loss' : isEdit && (s.pay_weight || s.recv_weight) ? 'settle' : 'carry');
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isEdit = sample?.status === 'received';

  const submitPart = async () => {
    if (submittingRef.current || !sample) return;
    const w = parseFloat(partWeight);
    if (!w || w <= 0) { notify('Missing', 'Enter the weight that came back'); return; }
    submittingRef.current = true;
    setBusy(true);
    try {
      await api.post(`/samples/${sample.id}/receive-part`, { weight: w, pieces: parseInt(partPcs, 10) || 0 });
      await savePhoto(sample.id);
      router.back();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const submit = async () => {
    if (mode === 'part') { submitPart(); return; }
    if (submittingRef.current || !sample) return;
    const w = parseFloat(receivedWeight);
    if (!w || w <= 0) { notify('Missing', 'Enter the weight received back'); return; }
    submittingRef.current = true;
    setBusy(true);
    try {
      const payload = {
        received_weight: w,
        pay_weight: gapChoice === 'settle' ? parseFloat(payWeight) || 0 : 0,
        recv_weight: gapChoice === 'settle' ? parseFloat(recvWeight) || 0 : 0,
        write_off_loss: gapChoice === 'loss',
      };
      if (isEdit) await api.put(`/samples/${sample.id}/receive`, payload);
      else await api.post(`/samples/${sample.id}/receive`, payload);
      await savePhoto(sample.id);
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
          <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </GlassButton>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}>
          {loading ? <ActivityIndicator color={colors.brandPrimary} /> : (
            <Text style={styles.diffHint} testID="receive-not-found">This stock entry couldn&apos;t be found. Go back and open it from Stock In/Out.</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const ps = partsSummary(sample);
  const hasParts = ps.parts.length > 0;
  const w = parseFloat(receivedWeight) || 0;
  const diff = receivedWeight ? round3(w - ps.outW) : 0;
  const pw = parseFloat(partWeight) || 0;
  const pp = parseInt(partPcs, 10) || 0;

  const purityText = sample.purity ? `${sample.purity}%` : '—';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="receive-sample-screen">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>{isEdit ? 'Edit Receive' : 'Receive Sample'}</Text>
        {isEdit ? (
          <GlassButton onPress={removeReceive} disabled={deleting} style={styles.iconBtn} testID="delete-receive-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </GlassButton>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.pickedCard}>
            <Text style={styles.cName}>{sample.sample_code}{sample.tag_number ? ` · Tag ${sample.tag_number}` : ''}</Text>
            <Text style={styles.cMeta}>with {sample.karigar_name}</Text>
          </View>

          {/* The photos taken at issue, to check the piece coming back is the same one. */}
          {sample.photo ? <Image source={{ uri: sample.photo }} style={styles.issuePhoto} contentFit="cover" testID="receive-issue-photo" /> : null}
          <RecordPhotos refType="sample" refId={sample.id} label="Photos at issue" readOnly
            emptyText={sample.photo ? '' : 'No photos were taken when this was issued.'} />

          {/* What was issued, to check against what's come back. */}
          <View style={styles.detailRow} testID="receive-issued-details">
            <View style={[styles.detailCell, { flex: 1.4 }]}>
              <Text style={styles.detailLabel}>Type of issue</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{sample.issue_type || '—'}</Text>
            </View>
            <View style={[styles.detailCell, { flex: 1.6 }]}>
              <Text style={styles.detailLabel}>Purity</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{purityText}</Text>
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>Pieces</Text>
              <Text style={styles.detailValue}>{sample.pc_count ?? 1}</Text>
            </View>
          </View>
          <View style={[styles.detailCell, styles.detailWide]} testID="receive-description">
            <Text style={styles.detailLabel}>Description</Text>
            <Text style={[styles.detailValue, styles.detailDesc]}>{sample.description || '—'}</Text>
          </View>

          {hasParts && (
            <View style={styles.partsCard} testID="receive-parts-so-far">
              <Text style={styles.partsTitle}>Already back · {ps.backW.toFixed(3)}g{ps.backPcs ? ` · ${ps.backPcs} pc` : ''}</Text>
              {ps.parts.map((p) => (
                <Text key={p.id} style={styles.partsLine}>{istDateTime(p.received_at)} · {p.pieces ? `${p.pieces} pc · ` : ''}{p.weight.toFixed(3)}g</Text>
              ))}
            </View>
          )}

          {!isEdit && (
            <View style={styles.modeRow}>
              {(['all', 'part'] as const).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} testID={`receive-mode-${m}`}>
                  <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'all' ? (hasParts ? 'Rest is back' : 'All back') : 'Only part back'}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.partRow}>
            <View style={styles.fieldColFlex}>
              <Text style={styles.label}>{hasParts ? 'Still out (g)' : 'Issued weight (g)'}</Text>
              <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{ps.outW.toFixed(3)}</Text></View>
            </View>
            {(sample.pc_count ?? 1) > 1 && (
              <View style={styles.fieldColFlex}>
                <Text style={styles.label}>{hasParts ? 'Pieces still out' : 'Pieces'}</Text>
                <View style={styles.readonlyBox}><Text style={styles.readonlyBoxText}>{ps.outPcs}</Text></View>
              </View>
            )}
          </View>

          {mode === 'part' ? (
            <>
              <View style={styles.partRow}>
                {(sample.pc_count ?? 1) > 1 && (
                  <View style={styles.fieldColFlex}>
                    <Text style={styles.label}>Pieces back now</Text>
                    <TextInput testID="part-pieces" value={partPcs} onChangeText={(v) => setPartPcs(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
                  </View>
                )}
                <View style={styles.fieldColFlex}>
                  <Text style={styles.label}>Weight back now (g)</Text>
                  <TextInput testID="part-weight" value={partWeight} onChangeText={(v) => setPartWeight(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} autoFocus />
                </View>
              </View>
              <Text style={[styles.diffHint, pw >= ps.outW && { color: colors.onError }]} testID="part-left">
                {pw >= ps.outW ? 'That is everything still out — use "All back" instead.'
                  : `Still with ${sample.karigar_name} after this: ${(sample.pc_count ?? 1) > 1 ? `${Math.max(0, ps.outPcs - pp)} pc · ` : ''}${round3(ps.outW - pw).toFixed(3)}g. Any shortfall is settled when the rest comes back.`}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Received weight (g)</Text>
              <TextInput
                testID="received-weight" value={receivedWeight}
                onChangeText={(v) => setReceivedWeight(v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad" placeholder="0.000"
                placeholderTextColor={colors.mutedText} style={styles.input}
              />

              {!!receivedWeight && (
                <Text style={[styles.diffHint, diff !== 0 && { color: diff > 0 ? colors.onWarning : colors.onSuccess }]}>
                  {diff === 0 ? `Matches the ${hasParts ? 'weight still out' : 'issued weight'} exactly.` : `${diff > 0 ? '+' : ''}${diff.toFixed(3)}g vs ${hasParts ? 'still out' : 'issued'} — expected the same weight back.`}
                </Text>
              )}
            </>
          )}

          {/* Only when there's a gap — an exact match just posts the plain
              receive entry above, nothing to choose. */}
          {mode === 'all' && diff !== 0 && (
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

          {/* Optional photo of what came back (all or part). */}
          {(!isEdit || mode === 'part') && (
            <>
              <Text style={styles.label}>Photo of what came back (optional)</Text>
              <Pressable onPress={() => setCameraOpen(true)} style={styles.recvPhotoBtn} testID="receive-photo-btn" accessibilityRole="button" accessibilityLabel={photo ? 'Retake photo' : 'Take photo'}>
                {photo ? <Image source={{ uri: photo }} style={styles.recvPhotoImg} contentFit="cover" />
                  : (<><Ionicons name="camera-outline" size={22} color={colors.brandSecondary} /><Text style={styles.recvPhotoText}>Take photo</Text></>)}
              </Pressable>
              {!!photo && (
                <Pressable onPress={() => setCameraOpen(true)} hitSlop={6} style={{ alignSelf: 'flex-end', marginTop: 6 }} testID="receive-photo-retake">
                  <Text style={[styles.recvPhotoText, { fontSize: 12 }]}>Retake</Text>
                </Pressable>
              )}
            </>
          )}
          {isEdit && mode !== 'part' && <RecordPhotos refType="sample_receive" refId={sample.id} label="Photos when received" />}

          <Pressable
            style={[styles.saveBtn, busy && { opacity: 0.6 }]} disabled={busy}
            onPress={submit} testID="confirm-receive-sample-btn"
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{isEdit ? 'Save Changes' : mode === 'part' ? 'Receive Part' : 'Confirm Receipt'}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <PhotoCaptureModal visible={cameraOpen} title="What came back" onClose={() => setCameraOpen(false)} highRes
        onCapture={async (p) => { setPhoto(p); setCameraOpen(false); }} />
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

  recvPhotoBtn: {
    marginTop: 6, minHeight: 72, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden',
  },
  recvPhotoImg: { width: '100%', height: 220 },
  recvPhotoText: { color: colors.brandSecondary, fontSize: 14, fontWeight: '700' },
  issuePhoto: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, marginTop: spacing.md },
  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  detailRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  detailCell: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  detailWide: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', marginTop: spacing.sm },
  detailDesc: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  detailLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  detailValue: { color: colors.onSurface, fontSize: 15, fontWeight: '700', marginTop: 2 },
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

  partRow: { flexDirection: 'row', gap: spacing.md },
  settleRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  fieldColFlex: { flex: 1 },
  settleHint: { color: colors.mutedText, fontSize: 11, marginTop: 4 },

  partsCard: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, gap: 3 },
  partsTitle: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '800' },
  partsLine: { color: colors.onSurfaceSecondary, fontSize: 12.5 },
  modeRow: { flexDirection: 'row', gap: 6, marginTop: spacing.lg, padding: 3, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md - 2 },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceSecondary, fontSize: 13.5, fontWeight: '700' },
  modeTextActive: { color: colors.onBrandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
